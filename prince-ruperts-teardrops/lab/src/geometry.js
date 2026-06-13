import * as THREE from "three";
import { clamp, smoothstep } from "./math.js";

export const spineSegments = 190;
export const radialSegments = 56;
export const cutRadialSegments = 36;

export function spine(t, params) {
  const tail = smoothstep(0.64, 1, t);
  const curl = Math.sin(Math.PI * tail) * tail;
  const x = params.bend * Math.pow(t, 2.35) +
    params.hook * (0.95 * curl + 0.14 * tail);
  const y = params.length / 2 - params.length * t;
  const z = params.depth * Math.sin(Math.PI * t) * Math.pow(t, 0.7);
  return new THREE.Vector3(x, y, z);
}

export function tangentAt(t, params) {
  const step = 0.001;
  const a = spine(clamp(t - step, 0, 1), params);
  const b = spine(clamp(t + step, 0, 1), params);
  return b.sub(a).normalize();
}

function initialNormal(tangent) {
  const zAxis = new THREE.Vector3(0, 0, 1);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const reference = Math.abs(tangent.dot(zAxis)) > 0.92 ? xAxis : zAxis;
  return new THREE.Vector3().crossVectors(reference, tangent).normalize();
}

export function radiusAt(t, params) {
  if (t <= 0 || t >= 1) {
    return 0;
  }

  const peak = params.headPos;
  if (t <= peak) {
    const u = clamp(t / peak, 0, 1);
    const rise = Math.sin(u * Math.PI * 0.5);
    return params.headSize * Math.pow(rise, params.headSmooth);
  }

  const u = clamp((t - peak) / (1 - peak), 0, 1);
  const fall = Math.cos(u * Math.PI * 0.5);
  return params.headSize * Math.pow(Math.max(0, fall), params.tailTaper);
}

export function buildFrames(params) {
  const frames = [];
  const firstTangent = tangentAt(0, params);
  let normal = initialNormal(firstTangent);
  let binormal = new THREE.Vector3().crossVectors(firstTangent, normal).normalize();
  let previousTangent = firstTangent;

  for (let i = 0; i <= spineSegments; i += 1) {
    const s = i / spineSegments;
    const t = 0.5 - 0.5 * Math.cos(Math.PI * s);
    const center = spine(t, params);
    const tangent = tangentAt(t, params);

    if (i > 0) {
      const rotation = new THREE.Quaternion().setFromUnitVectors(previousTangent, tangent);
      normal.applyQuaternion(rotation).normalize();
      binormal.crossVectors(tangent, normal).normalize();
      normal.crossVectors(binormal, tangent).normalize();
    }

    frames.push({
      t,
      center,
      tangent: tangent.clone(),
      normal: normal.clone(),
      binormal: binormal.clone()
    });

    previousTangent = tangent;
  }

  return frames;
}

// Surface of revolution around the spine; uv = (angle fraction, t).
// With cut=true only the back half is generated, leaving the cut plane open.
export function buildSurfaceGeometry(params, frames, cut) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringCount = cut ? Math.floor(radialSegments / 2) + 1 : radialSegments;
  const ringSegments = cut ? ringCount - 1 : radialSegments;
  const angleStart = cut ? Math.PI : 0;
  const angleSpan = cut ? Math.PI : Math.PI * 2;

  frames.forEach((frame) => {
    const t = frame.t;
    const radius = radiusAt(t, params);

    for (let j = 0; j < ringCount; j += 1) {
      const amount = cut ? j / (ringCount - 1) : j / radialSegments;
      const angle = angleStart + amount * angleSpan;
      const offset = frame.normal.clone()
        .multiplyScalar(Math.cos(angle) * radius)
        .add(frame.binormal.clone().multiplyScalar(Math.sin(angle) * radius));
      const point = frame.center.clone().add(offset);

      positions.push(point.x, point.y, point.z);
      uvs.push(j / radialSegments, t);
    }
  });

  for (let i = 0; i < frames.length - 1; i += 1) {
    for (let j = 0; j < ringSegments; j += 1) {
      const next = cut ? j + 1 : (j + 1) % ringCount;
      const a = i * ringCount + j;
      const b = i * ringCount + next;
      const c = (i + 1) * ringCount + j;
      const d = (i + 1) * ringCount + next;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Flat strip through the spine; uv = (across in [0,1], t), rho = |across*2-1|.
export function buildCutPlaneGeometry(params, frames) {
  const positions = [];
  const uvs = [];
  const indices = [];

  frames.forEach((frame) => {
    const t = frame.t;
    const radius = radiusAt(t, params);
    for (let j = 0; j <= cutRadialSegments; j += 1) {
      const across = j / cutRadialSegments;
      const signedRadius = (across * 2 - 1) * radius;
      const point = frame.center.clone().add(frame.normal.clone().multiplyScalar(signedRadius));

      positions.push(point.x, point.y, point.z);
      uvs.push(across, t);
    }
  });

  const rowCount = cutRadialSegments + 1;
  for (let i = 0; i < frames.length - 1; i += 1) {
    for (let j = 0; j < cutRadialSegments; j += 1) {
      const a = i * rowCount + j;
      const b = i * rowCount + j + 1;
      const c = (i + 1) * rowCount + j;
      const d = (i + 1) * rowCount + j + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
