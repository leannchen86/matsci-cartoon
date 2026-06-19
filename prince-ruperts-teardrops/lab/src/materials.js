import * as THREE from "three";
import { GLSL_STRESS_COLOR } from "./colors.js";

// Residual stress field baked into a (t, rho) texture; R channel holds the
// stress normalized to [min, max].
export function buildStressTexture(stressModel) {
  const width = 256;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  const range = Math.max(stressModel.max - stressModel.min, 1e-6);

  for (let k = 0; k < height; k += 1) {
    const rho = k / (height - 1);
    for (let i = 0; i < width; i += 1) {
      const t = i / (width - 1);
      const value = (stressModel.sample(t, rho) - stressModel.min) / range;
      const offset = (k * width + i) * 4;
      data[offset] = Math.round(value * 255);
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createSharedUniforms(stressTexture, stressModel) {
  return {
    uStressTex: { value: stressTexture },
    uMin: { value: stressModel.min },
    uMax: { value: stressModel.max },
    uContact: { value: new THREE.Vector3() },
    uContactOn: { value: 0 },
    uP0: { value: 0 },
    uA: { value: 1 },
    uBroken: { value: 0 },
    uBreakT: { value: 0 },
    uFrontT: { value: 0 },
    uCriticality: { value: 0 },
    uReveal: { value: 1 }
  };
}

const vertexShader = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uStressTex;
uniform float uMin;
uniform float uMax;
uniform vec3 uContact;
uniform float uContactOn;
uniform float uP0;
uniform float uA;
uniform float uBroken;
uniform float uBreakT;
uniform float uFrontT;
uniform float uCriticality;
uniform float uReveal;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

${GLSL_STRESS_COLOR}

void main() {
  float t = vUv.y;
  if (uBroken > 0.5 && abs(t - uBreakT) <= uFrontT) {
    discard;
  }

#ifdef CUT_PLANE
  float rho = abs(vUv.x * 2.0 - 1.0);
#else
  float rho = 1.0;
#endif

  float s = mix(uMin, uMax, texture2D(uStressTex, vec2(t, rho)).r);

  if (uContactOn > 0.5 && uP0 > 0.0) {
    float d = distance(vWorld, uContact);
    float ring = d / uA;
#ifdef CUT_PLANE
    // Interior sees the compressive bulb under the indenter.
    s += -2.6 * uP0 * exp(-ring * ring * 0.7);
#else
    // Mirrors appliedSurfaceStress() in physics.js.
    float compression = -2.6 * uP0 * exp(-ring * ring * 2.2);
    float tension = uP0 * (ring < 1.0 ? ring * ring * ring : 1.0 / max(ring * ring, 1e-4));
    s += compression + tension;
#endif
  }

  vec3 col = stressColor(s);

  // As the contact nears failure, tensile regions flush hot-white — the stored
  // tension responding, about to release.
  float crit = smoothstep(0.5, 1.0, uCriticality) * smoothstep(0.0, 80.0, s);
  col = mix(col, vec3(1.0, 0.93, 0.78), crit * 0.5);

  // Reveal fade-in: the stress colours bloom out of glassy white when you cut.
  col = mix(vec3(0.97, 0.97, 0.98), col, uReveal);

#ifdef CUT_PLANE
  gl_FragColor = vec4(col, 1.0);
#else
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) {
    n = -n;
  }
  vec3 l1 = normalize(vec3(-0.3, -0.45, 0.85));
  vec3 l2 = normalize(vec3(0.6, 0.5, 0.3));
  float diffuse = 0.62 + 0.32 * max(dot(n, l1), 0.0) + 0.18 * max(dot(n, l2), 0.0);
  col *= min(diffuse, 1.12);

  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - abs(dot(n, view)), 3.0);
  col = mix(col, col * 0.55, fresnel * 0.6);

  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

export function createDropMaterial(uniforms, cutPlane) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines: cutPlane ? { CUT_PLANE: "" } : {},
    side: THREE.DoubleSide
  });
}
