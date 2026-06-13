import * as THREE from "three";
import { EXPLOSION } from "./config.js";
import { radiusAt } from "./geometry.js";
import { stressColorJS } from "./colors.js";

const particleVertexShader = /* glsl */ `
attribute vec3 aVelocity;
attribute vec3 aColor;
attribute float aBirth;
attribute float aSize;
attribute float aLife;

uniform float uTime;
uniform float uGravity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  float age = uTime - aBirth;
  if (age <= 0.0) {
    vAlpha = 0.0;
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 pos = position + aVelocity * age + vec3(0.0, -0.5 * uGravity * age * age, 0.0);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vAlpha = 1.0 - smoothstep(aLife * 0.55, aLife, age);
  float size = aSize * (1500.0 / max(-mvPosition.z, 1.0));
  gl_PointSize = min(size * mix(1.0, 0.55, smoothstep(0.0, aLife, age)), 80.0);
}
`;

const particleFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float d = length(offset);
  float alpha = vAlpha * smoothstep(0.5, 0.18, d);
  if (alpha < 0.01) {
    discard;
  }
  gl_FragColor = vec4(vColor, alpha);
}
`;

// Pre-generates fragment particles through the drop volume. Velocities scale
// with local residual stress magnitude (stored strain energy), so the tensile
// core flies hardest. Birth times are assigned at fracture time so debris
// appears as the crack front sweeps past.
export function createParticles(params, frames, stressModel) {
  let maxRadius = 0;
  frames.forEach((frame) => {
    maxRadius = Math.max(maxRadius, radiusAt(frame.t, params));
  });

  const positions = [];
  const velocities = [];
  const colors = [];
  const sizes = [];
  const lives = [];
  const axialT = [];

  const randomUnit = () => {
    const v = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    );
    return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  };

  frames.forEach((frame) => {
    const radius = radiusAt(frame.t, params);
    if (radius <= 0.5) {
      return;
    }
    const count = Math.max(
      6,
      Math.round(EXPLOSION.particlesPerFrame * (0.18 + 0.82 * (radius / maxRadius)))
    );

    for (let n = 0; n < count; n += 1) {
      const rho = Math.sqrt(Math.random());
      const angle = Math.random() * Math.PI * 2;
      const radial = frame.normal.clone()
        .multiplyScalar(Math.cos(angle))
        .add(frame.binormal.clone().multiplyScalar(Math.sin(angle)));
      const point = frame.center.clone().add(radial.clone().multiplyScalar(rho * radius));

      const stress = stressModel.sample(frame.t, rho);
      const speed = (90 + 2.0 * Math.abs(stress)) * (0.7 + 0.6 * Math.random());
      const direction = radial.clone()
        .multiplyScalar(0.8 + 0.45 * Math.random())
        .add(frame.tangent.clone().multiplyScalar((Math.random() - 0.5) * 0.9))
        .add(randomUnit().multiplyScalar(0.45))
        .normalize();

      // Darken on the white background; neutral interior reads as pale glass.
      const tint = 0.55 + Math.random() * 0.3;
      const color = stressColorJS(stress);

      positions.push(point.x, point.y, point.z);
      velocities.push(direction.x * speed, direction.y * speed, direction.z * speed);
      colors.push(
        Math.min(color.r * tint, 1),
        Math.min(color.g * tint, 1),
        Math.min(color.b * tint, 1)
      );
      sizes.push(5 + Math.random() * 9 + 4 * Math.min(Math.abs(stress) / 650, 1));
      lives.push(EXPLOSION.lifeMin + Math.random() * (EXPLOSION.lifeMax - EXPLOSION.lifeMin));
      axialT.push(frame.t);
    }
  });

  const birth = new Float32Array(axialT.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aVelocity", new THREE.Float32BufferAttribute(velocities, 3));
  geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("aLife", new THREE.Float32BufferAttribute(lives, 1));
  geometry.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGravity: { value: EXPLOSION.gravity }
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 4;

  return {
    points,
    prime(breakT, frontSpeed) {
      const attribute = geometry.getAttribute("aBirth");
      for (let i = 0; i < axialT.length; i += 1) {
        attribute.array[i] = Math.abs(axialT[i] - breakT) / frontSpeed;
      }
      attribute.needsUpdate = true;
      material.uniforms.uTime.value = 0;
      points.visible = true;
    },
    setTime(time) {
      material.uniforms.uTime.value = time;
    },
    hide() {
      points.visible = false;
      material.uniforms.uTime.value = 0;
    }
  };
}
