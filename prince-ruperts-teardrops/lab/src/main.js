import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SHAPE, PHYSICS, EXPLOSION } from "./config.js";
import { buildFrames, buildSurfaceGeometry, buildCutPlaneGeometry } from "./geometry.js";
import { buildStressModel } from "./stressModel.js";
import { buildStressTexture, createSharedUniforms, createDropMaterial } from "./materials.js";
import { createParticles } from "./particles.js";
import { createStressField } from "./glyphs.js";
import { tensionPeak, contactRadiusAt, maxAppliedTension } from "./physics.js";
import { clamp } from "./math.js";

const forceInput = document.getElementById("force");
const cutInput = document.getElementById("cut");
const fieldInput = document.getElementById("field");
const slowmoInput = document.getElementById("slowmo");
const resetButton = document.getElementById("reset");

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

const dropMesh = new THREE.Mesh(fullGeometry, createDropMaterial(uniforms, false));
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

const indicator = new THREE.Mesh(
  new THREE.RingGeometry(0.78, 1, 48),
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

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

const poke = {
  placed: false,   // a contact point has been planted on the drop
  placing: false,  // currently dragging to reposition that point
  force: 0,        // driven by the Force slider
  t: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 0, 1)
};

const hover = {
  hasHit: false,
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
camera.far = sphere.radius * 12;
camera.updateProjectionMatrix();
orbit.minDistance = sphere.radius * 0.35;
orbit.maxDistance = sphere.radius * 6;

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
  updatePointer(event);
  const hit = raycastDrop();
  if (poke.placing) {
    if (hit) {
      applyHit(hit);
    }
  } else {
    hover.hasHit = Boolean(hit);
    if (hit) {
      hover.point.copy(hit.point);
      hitNormal(hit, hover.normal);
      orbit.autoRotate = false;
    }
  }
  renderer.domElement.style.cursor = hit || poke.placing ? "crosshair" : "";
});

// Click (or drag) on the drop plants the contact point; the Force slider then
// controls how hard you press there. Dragging the background orbits.
renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  orbit.autoRotate = false;
  updatePointer(event);
  const hit = raycastDrop();
  if (hit) {
    applyHit(hit);
    poke.placing = true;
    orbit.enabled = false;
  }
});

function endPlacing() {
  poke.placing = false;
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
  particles.prime(poke.t, state.frontSpeed);
  uniforms.uBroken.value = 1;
  uniforms.uBreakT.value = poke.t;
  uniforms.uFrontT.value = 0;
  endPlacing();
  poke.placed = false;
  indicator.visible = false;
}

function reset() {
  state.broken = false;
  state.simTime = 0;
  poke.force = 0;
  poke.placed = false;
  poke.placing = false;
  hover.hasHit = false;
  forceInput.value = "0";
  uniforms.uBroken.value = 0;
  uniforms.uFrontT.value = 0;
  uniforms.uContactOn.value = 0;
  particles.hide();
  orbit.enabled = true;
}

resetButton.addEventListener("click", reset);

function applyCut() {
  dropMesh.geometry = cutInput.checked ? halfGeometry : fullGeometry;
  cutPlaneMesh.visible = cutInput.checked;
}

cutInput.addEventListener("input", applyCut);

fieldInput.addEventListener("input", () => {
  // The glyph field lives on the cut plane, so reveal the interior with it.
  if (fieldInput.checked && !cutInput.checked) {
    cutInput.checked = true;
    applyCut();
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  stressField.setResolution(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  update(Math.min(clock.getDelta(), 0.1));
}

function update(dt) {
  if (state.broken) {
    stressField.object.visible = false;
    state.simTime += dt * Number(slowmoInput.value);
    uniforms.uFrontT.value = state.simTime * state.frontSpeed;
    particles.setTime(state.simTime);
  } else {
    elapsed += dt;
    poke.force = Number(forceInput.value);

    const engaged = poke.placed && poke.force > 0.001;
    uniforms.uContactOn.value = engaged ? 1 : 0;
    if (engaged) {
      uniforms.uContact.value.copy(poke.point);
      uniforms.uP0.value = tensionPeak(poke.force);
      uniforms.uA.value = contactRadiusAt(poke.force);

      // Failure: net tension at the contact edge exceeds glass strength.
      const residual = stressModel.sample(poke.t, 1);
      const budget = PHYSICS.strengthMPa - residual;
      if (maxAppliedTension(poke.force) >= budget) {
        explode();
      }
    }

    stressField.object.visible = !state.broken && fieldInput.checked;
    if (stressField.object.visible) {
      stressField.update(engaged, poke.point, uniforms.uP0.value, uniforms.uA.value, elapsed);
    }

    if (!state.broken) {
      const showContact = poke.placed;
      indicator.visible = showContact || hover.hasHit;
      if (showContact) {
        indicator.material.opacity = 0.9;
        indicator.position.copy(poke.point).addScaledVector(poke.normal, 2);
        indicator.scale.setScalar(contactRadiusAt(Math.max(poke.force, 0.18)));
        indicator.lookAt(poke.point.clone().add(poke.normal));
      } else if (hover.hasHit) {
        const pulse = 1 + 0.12 * Math.sin(elapsed * 5);
        indicator.material.opacity = 0.5;
        indicator.position.copy(hover.point).addScaledVector(hover.normal, 2);
        indicator.scale.setScalar(contactRadiusAt(0.3) * pulse);
        indicator.lookAt(hover.point.clone().add(hover.normal));
      }
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
