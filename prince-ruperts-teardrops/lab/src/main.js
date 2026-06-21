import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SHAPE, PHYSICS, EXPLOSION } from "./config.js";
import { buildFrames, buildSurfaceGeometry, buildCutPlaneGeometry, radiusAt } from "./geometry.js";
import { buildStressModel } from "./stressModel.js";
import { buildStressTexture, createSharedUniforms, createDropMaterial } from "./materials.js";
import { createParticles } from "./particles.js";
import { createStressField } from "./glyphs.js";
import { tensionPeak, contactRadiusAt, maxAppliedTension } from "./physics.js";
import { clamp } from "./math.js";

const cutInput = document.getElementById("cut");
const fieldInput = document.getElementById("field");
const slowmoInput = document.getElementById("slowmo");
const resetButton = document.getElementById("reset");

// Stress colour key — only meaningful once you cut, so hidden on clear glass.
const legendEl = document.querySelector(".legend");
legendEl.style.display = "none";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0xffffff, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.insertBefore(renderer.domElement, document.getElementById("panel"));

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.autoRotate = true;
orbit.autoRotateSpeed = 0.12;

// Static build: shape is fixed, so geometry, stress field, and particles are
// all computed once.
const frames = buildFrames(SHAPE);
const stressModel = buildStressModel(SHAPE);
const stressTexture = buildStressTexture(stressModel);
const uniforms = createSharedUniforms(stressTexture, stressModel);

const fullGeometry = buildSurfaceGeometry(SHAPE, frames, false);
const halfGeometry = buildSurfaceGeometry(SHAPE, frames, true);
const cutPlaneGeometry = buildCutPlaneGeometry(SHAPE, frames);

// Two looks for the body: clean transparent glass on the whole drop (it looks
// innocent — the danger is invisible) vs the diverging stress heatmap revealed
// on the cut cross-section.
const heatMaterial = createDropMaterial(uniforms, false);

// Environment the clear glass reflects/refracts. A soft studio base with a
// restrained cyberpunk lean — a cyan zone on one side, magenta on the other —
// so the glass picks up neon glints without going dark or loud.
function makeCyberEnvironment() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, "#e8edf6");
  base.addColorStop(1, "#ffffff");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);

  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
  };
  glow(150, 88, 175, "rgba(38, 208, 255, 0.65)");  // cyan
  glow(388, 172, 185, "rgba(255, 64, 208, 0.5)");  // magenta
  glow(300, 36, 130, "rgba(150, 120, 255, 0.32)"); // violet up top

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(makeCyberEnvironment()).texture;

const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
keyLight.position.set(1.0, 1.6, 2.0);
// A restrained cyberpunk accent: cyan glint on one flank, magenta on the other.
const cyanLight = new THREE.DirectionalLight(0x1fd8ff, 1.7);
cyanLight.position.set(-1.5, 1.1, 1.0);
const magentaLight = new THREE.DirectionalLight(0xff3ddb, 1.5);
magentaLight.position.set(-1.4, -0.6, -1.2);
scene.add(keyLight, cyanLight, magentaLight);

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 1.0,
  thickness: 150,
  ior: 1.5,
  roughness: 0.03,
  metalness: 0.0,
  transparent: true,
  side: THREE.DoubleSide,
  envMapIntensity: 1.5,
  clearcoat: 0.5,
  clearcoatRoughness: 0.08,
  attenuationColor: new THREE.Color(0xdfeaff),
  attenuationDistance: 700
});

const dropMesh = new THREE.Mesh(fullGeometry, glassMaterial);
dropMesh.renderOrder = 1;
scene.add(dropMesh);

const cutPlaneMesh = new THREE.Mesh(cutPlaneGeometry, createDropMaterial(uniforms, true));
cutPlaneMesh.renderOrder = 2;
cutPlaneMesh.visible = false;
scene.add(cutPlaneMesh);

const particles = createParticles(SHAPE, frames, stressModel);
scene.add(particles.points);

const stressField = createStressField(SHAPE, frames, stressModel);
scene.add(stressField.object);

// Contact footprint: an outline ring that marks where you're pressing and
// grows with force. Faces the surface (oriented by the contact normal).
const indicator = new THREE.Mesh(
  new THREE.RingGeometry(0.82, 1, 48),
  new THREE.MeshBasicMaterial({
    color: 0x111111,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: false
  })
);
indicator.renderOrder = 10;
indicator.visible = false;
scene.add(indicator);

// Failure-index glow: an additive hot halo at the contact whose brightness,
// size and pulse-rate climb as net tension (residual + applied) approaches the
// glass strength. Cool/absent = safe; flushing white-hot = about to fracture.
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const criticalGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xff7a1a,
    transparent: true,
    opacity: 0,
    depthTest: false,
    blending: THREE.AdditiveBlending
  })
);
criticalGlow.renderOrder = 11;
criticalGlow.visible = false;
scene.add(criticalGlow);
const glowColor = new THREE.Color();

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

const poke = {
  placed: false,   // a contact point has been planted on the drop
  placing: false,  // currently dragging to reposition that point
  holding: false,  // mouse held down -> force is building
  force: 0,        // press magnitude: ramps up while held, decays on release
  t: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 0, 1)
};

const hover = {
  hasHit: false,
  t: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 0, 1)
};

const state = {
  broken: false,
  simTime: 0,
  frontSpeed: 1
};

fullGeometry.computeBoundingSphere();
const sphere = fullGeometry.boundingSphere.clone();
camera.near = Math.max(0.1, sphere.radius / 700);
camera.far = sphere.radius * 40; // room for the gradient backdrop sphere
camera.updateProjectionMatrix();
orbit.minDistance = sphere.radius * 0.35;
orbit.maxDistance = sphere.radius * 6;

// Subtle gradient backdrop so the clear glass has tonal variation to bend and
// reflect — pure white gave the glass nothing to refract, so it read as milky.
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uTop: { value: new THREE.Color(0xcdd6ee) },
    uBottom: { value: new THREE.Color(0xfbf4f8) }
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vDir;
    uniform vec3 uTop;
    uniform vec3 uBottom;
    void main() {
      float h = normalize(vDir).y * 0.5 + 0.5;
      gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.1, 0.95, h)), 1.0);
    }
  `
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial);
sky.scale.setScalar(sphere.radius * 10);
sky.position.copy(sphere.center);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

function fitCamera() {
  const fov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const distance = (sphere.radius / Math.sin(fov)) * 1.14;
  camera.position.set(
    sphere.center.x - sphere.radius * 0.12,
    sphere.center.y - sphere.radius * 0.04,
    sphere.center.z + distance
  );
  camera.lookAt(sphere.center);
  orbit.target.copy(sphere.center);
  orbit.update();
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycastDrop() {
  if (state.broken) {
    return null;
  }
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObject(dropMesh, false);
  return hits.length > 0 ? hits[0] : null;
}

const normalMatrix = new THREE.Matrix3();

function hitNormal(hit, out) {
  if (hit.face) {
    out.copy(hit.face.normal)
      .applyNormalMatrix(normalMatrix.getNormalMatrix(dropMesh.matrixWorld))
      .normalize();
  }
}

function applyHit(hit) {
  poke.placed = true;
  poke.t = clamp(hit.uv.y, 0.001, 0.999);
  poke.point.copy(hit.point);
  hitNormal(hit, poke.normal);
}

renderer.domElement.addEventListener("pointermove", (event) => {
  if (demo.active) {
    return;
  }
  updatePointer(event);
  const hit = raycastDrop();
  if (poke.placing) {
    if (hit) {
      applyHit(hit);
    }
  } else {
    hover.hasHit = Boolean(hit);
    if (hit) {
      hover.t = clamp(hit.uv.y, 0.001, 0.999);
      hover.point.copy(hit.point);
      hitNormal(hit, hover.normal);
      orbit.autoRotate = false;
    }
  }
  renderer.domElement.style.cursor = hit || poke.placing ? "crosshair" : "";
});

// Press-and-hold on the drop: clicking plants the contact and *holding* builds
// the force there; releasing lets it decay; dragging repositions the press.
// Dragging the background orbits.
renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  markUserTouched();
  orbit.autoRotate = false;
  updatePointer(event);
  const hit = raycastDrop();
  if (hit) {
    applyHit(hit);
    poke.placing = true;
    poke.holding = true;
    orbit.enabled = false;
  }
});

function endPlacing() {
  poke.placing = false;
  poke.holding = false;
  orbit.enabled = true;
}

renderer.domElement.addEventListener("pointerup", endPlacing);
renderer.domElement.addEventListener("pointercancel", endPlacing);
renderer.domElement.addEventListener("pointerleave", () => {
  endPlacing();
  hover.hasHit = false;
});

function explode() {
  state.broken = true;
  state.simTime = 0;
  state.frontSpeed = Math.max(poke.t, 1 - poke.t) / EXPLOSION.frontSeconds;
  // Stress-coloured debris only in the analytical (cut/field) views; clear-glass
  // view shatters into colourless glass dust.
  const showStressColor = cutInput.checked || fieldInput.checked ? 1 : 0;
  particles.prime(poke.t, state.frontSpeed, showStressColor);
  uniforms.uBroken.value = 1;
  uniforms.uBreakT.value = poke.t;
  uniforms.uFrontT.value = 0;
  endPlacing();
  poke.placed = false;
  indicator.visible = false;
  criticalGlow.visible = false;
  // Glass can't shader-discard; hide it so only the debris flies. The cut
  // heatmap stays visible and erodes via the front sweep.
  dropMesh.visible = cutInput.checked;
}

function reset() {
  state.broken = false;
  state.simTime = 0;
  poke.force = 0;
  poke.placed = false;
  poke.placing = false;
  poke.holding = false;
  hover.hasHit = false;
  uniforms.uBroken.value = 0;
  uniforms.uFrontT.value = 0;
  uniforms.uContactOn.value = 0;
  uniforms.uCriticality.value = 0;
  particles.hide();
  criticalGlow.visible = false;
  dropMesh.visible = true;
  orbit.enabled = true;
}

resetButton.addEventListener("click", () => {
  markUserTouched();
  reset();
});

function applyCut() {
  // Whole drop -> clear glass; cut open -> the stress heatmap.
  dropMesh.geometry = cutInput.checked ? halfGeometry : fullGeometry;
  dropMesh.material = cutInput.checked ? heatMaterial : glassMaterial;
  cutPlaneMesh.visible = cutInput.checked;
  legendEl.style.display = cutInput.checked ? "block" : "none";
}

cutInput.addEventListener("input", () => {
  markUserTouched();
  applyCut();
});

fieldInput.addEventListener("input", () => {
  markUserTouched();
  // The glyph field lives on the cut plane, so reveal the interior with it.
  if (fieldInput.checked && !cutInput.checked) {
    cutInput.checked = true;
    applyCut();
  }
});

slowmoInput.addEventListener("input", markUserTouched);

// --- Attract loop ----------------------------------------------------------
// On load, auto-demonstrate the core move: tap the fragile tail, the whole drop
// disintegrates. Teaches "the drop is pokable" with no text, and bows out the
// instant the user touches anything.

const DEMO_T = 0.8;
const demo = { active: false, phase: "", timer: 0, contact: null };

function surfaceContactAt(tTarget) {
  let best = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.t - tTarget) < Math.abs(best.t - tTarget)) {
      best = frame;
    }
  }
  const radius = radiusAt(best.t, SHAPE);
  let point = null;
  let normal = null;
  let bestZ = -Infinity;
  for (let a = 0; a < 16; a += 1) {
    const angle = (a / 16) * Math.PI * 2;
    const radial = best.normal.clone().multiplyScalar(Math.cos(angle))
      .add(best.binormal.clone().multiplyScalar(Math.sin(angle)));
    const candidate = best.center.clone().addScaledVector(radial, radius);
    if (candidate.z > bestZ) {
      bestZ = candidate.z;
      point = candidate;
      normal = radial;
    }
  }
  return { t: best.t, point, normal };
}

function aimDemo() {
  demo.contact = surfaceContactAt(DEMO_T);
  demo.phase = "aim";
  demo.timer = 0;
  hover.hasHit = true;
  hover.t = demo.contact.t;
  hover.point.copy(demo.contact.point);
  hover.normal.copy(demo.contact.normal);
}

function startDemo() {
  if (demo.active || userTouched) {
    return;
  }
  demo.active = true;
  orbit.autoRotate = false;
  aimDemo();
}

function stopDemo() {
  if (!demo.active) {
    return;
  }
  demo.active = false;
  demo.phase = "";
  reset();
  hover.hasHit = false;
  orbit.autoRotate = true;
}

let userTouched = false;
function markUserTouched() {
  userTouched = true;
  stopDemo();
}

function updateDemo(dt) {
  if (!demo.active) {
    return;
  }
  demo.timer += dt;
  if (demo.phase === "aim") {
    if (demo.timer > 0.9) {
      poke.placed = true;
      poke.t = demo.contact.t;
      poke.point.copy(demo.contact.point);
      poke.normal.copy(demo.contact.normal);
      poke.force = 0;
      poke.holding = true; // press and hold -> force builds via update()
      hover.hasHit = false;
      demo.phase = "press";
      demo.timer = 0;
    }
  } else if (demo.phase === "press") {
    if (state.broken) {
      demo.phase = "shatter";
      demo.timer = 0;
    }
  } else if (demo.phase === "shatter") {
    if (demo.timer > 2.6) {
      reset();
      demo.phase = "rest";
      demo.timer = 0;
    }
  } else if (demo.phase === "rest") {
    if (demo.timer > 0.7) {
      aimDemo();
    }
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  stressField.setResolution(window.innerWidth, window.innerHeight);
});

// Failure-index glow: hot halo at the contact, brighter/whiter/faster-pulsing
// as net tension nears the strength limit (criticality -> 1).
function updateGlow(criticality, time) {
  if (!poke.placed || criticality < 0.12) {
    criticalGlow.visible = false;
    return;
  }
  const c = clamp(criticality, 0, 1);
  criticalGlow.visible = true;
  criticalGlow.position.copy(poke.point).addScaledVector(poke.normal, 3);
  const r = contactRadiusAt(Math.max(poke.force, 0.18));
  criticalGlow.scale.setScalar(r * (2.2 + 2.5 * c));
  glowColor.setRGB(1, 0.45 + 0.5 * c, 0.1 + 0.85 * c); // orange -> white-hot
  criticalGlow.material.color.copy(glowColor);
  const pulse = 0.78 + 0.22 * Math.sin(time * (5 + 22 * c));
  criticalGlow.material.opacity = (0.35 + 0.65 * c) * pulse;
}

const clock = new THREE.Clock();
let elapsed = 0;
let cutReveal = 0; // 0..1 fade-in of the stress colours when you cut

function animate() {
  requestAnimationFrame(animate);
  update(Math.min(clock.getDelta(), 0.1));
}

function update(dt) {
  updateDemo(dt);

  if (state.broken) {
    state.simTime += dt * Number(slowmoInput.value);
    uniforms.uFrontT.value = state.simTime * state.frontSpeed;
    particles.setTime(state.simTime);

    // The locked field releases ~3x faster than the fragmentation front, so
    // the arrows fling out and clear early instead of lingering on the
    // last-to-shatter head while the rest is already debris.
    const fieldRelease = uniforms.uFrontT.value * 3.0;
    stressField.object.visible = fieldInput.checked && fieldRelease < 1.2;
    if (stressField.object.visible) {
      stressField.update({
        engaged: false,
        contact: poke.point,
        p0: 0,
        contactRadius: 1,
        time: state.simTime,
        broken: true,
        breakT: uniforms.uBreakT.value,
        frontT: fieldRelease
      });
    }
  } else {
    elapsed += dt;

    // Stress colours bloom in over ~0.45s when cut; reset while whole.
    cutReveal = cutInput.checked ? clamp(cutReveal + dt / 0.45, 0, 1) : 0;
    uniforms.uReveal.value = cutInput.checked ? cutReveal : 1;

    // Press-and-hold: force ramps while the mouse is held, decays on release.
    if (!poke.placed) {
      poke.force = 0;
    } else {
      const rate = poke.holding
        ? dt / PHYSICS.holdRampSeconds
        : -dt / PHYSICS.releaseDecaySeconds;
      poke.force = clamp(poke.force + rate, 0, 1);
    }

    const engaged = poke.placed && poke.force > 0.001;
    uniforms.uContactOn.value = engaged ? 1 : 0;
    if (engaged) {
      uniforms.uContact.value.copy(poke.point);
      uniforms.uP0.value = tensionPeak(poke.force);
      uniforms.uA.value = contactRadiusAt(poke.force);
    }

    // Failure index = net tension (residual + applied) / strength at the
    // contact. >= 1 nucleates a crack and the drop detonates.
    let criticality = 0;
    if (poke.placed) {
      const residual = stressModel.sample(poke.t, 1);
      criticality = (residual + maxAppliedTension(poke.force)) / PHYSICS.strengthMPa;
      if (engaged && criticality >= 1) {
        explode();
      }
    }
    uniforms.uCriticality.value = clamp(criticality, 0, 1);

    if (!state.broken) {
      stressField.object.visible = fieldInput.checked;
      if (stressField.object.visible) {
        stressField.update({
          engaged,
          contact: poke.point,
          p0: uniforms.uP0.value,
          contactRadius: uniforms.uA.value,
          time: elapsed,
          broken: false,
          breakT: 0,
          frontT: 0
        });
      }

      // Contact footprint ring: where you're pressing, growing with force.
      const showContact = poke.placed;
      indicator.visible = showContact || hover.hasHit;
      if (showContact) {
        indicator.position.copy(poke.point).addScaledVector(poke.normal, 1.5);
        indicator.scale.setScalar(contactRadiusAt(Math.max(poke.force, 0.18)));
        indicator.lookAt(poke.point.clone().add(poke.normal));
        indicator.material.opacity = 0.9;
      } else if (hover.hasHit) {
        const pulse = 1 + 0.12 * Math.sin(elapsed * 5);
        indicator.position.copy(hover.point).addScaledVector(hover.normal, 1.5);
        indicator.scale.setScalar(contactRadiusAt(0.3) * pulse);
        indicator.lookAt(hover.point.clone().add(hover.normal));
        indicator.material.opacity = 0.5;
      }

      updateGlow(criticality, elapsed);
    }
  }

  orbit.update();
  renderer.render(scene, camera);
}

window.__lab = { scene, camera, renderer, dropMesh, stressModel, uniforms, poke, state, step: update };

camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
fitCamera();
animate();

// Auto-play the intro once the scene has settled, unless the user is already
// interacting.
setTimeout(startDemo, 900);
