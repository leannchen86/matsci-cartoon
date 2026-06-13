import * as THREE from "three";
import { smoothstep } from "./math.js";

// Diverging stress palette: compression blue, neutral cream, tension red.
// stressColorJS and GLSL_STRESS_COLOR must stay in sync.
export function stressColorJS(stressMpa) {
  const neutral = new THREE.Color(0xf7f0c8);
  const compression = new THREE.Color(0x206ad7);
  const tension = new THREE.Color(0xd8172f);
  if (stressMpa < 0) {
    return new THREE.Color().lerpColors(neutral, compression, smoothstep(0, 650, -stressMpa));
  }
  return new THREE.Color().lerpColors(neutral, tension, smoothstep(0, 420, stressMpa));
}

export const GLSL_STRESS_COLOR = /* glsl */ `
vec3 stressColor(float s) {
  vec3 neutral = vec3(0.969, 0.941, 0.784);
  vec3 compressionC = vec3(0.125, 0.416, 0.843);
  vec3 tensionC = vec3(0.847, 0.090, 0.184);
  if (s < 0.0) {
    return mix(neutral, compressionC, smoothstep(0.0, 650.0, -s));
  }
  return mix(neutral, tensionC, smoothstep(0.0, 420.0, s));
}
`;
