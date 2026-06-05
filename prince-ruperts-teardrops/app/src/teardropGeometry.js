import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
} from "three";

const refZ = new Vector3(0, 0, 1);
const refY = new Vector3(0, 1, 0);
export const BULB_END = 0.56;

const PROFILE_LENGTH = 1;
const NECK_Z = 0.56;
const AXIS_SCALE = 2.45;
const FRONT_CAP_END = 0.16;
const FRONT_CAP_RADIUS = 0.82;

const PROFILE_POINTS = [
  [FRONT_CAP_END, FRONT_CAP_RADIUS],
  [0.22, 0.87],
  [0.3, 0.89],
  [0.38, 0.84],
  [0.45, 0.72],
  [0.51, 0.53],
  [0.56, 0.34],
  [0.595, 0.23],
  [0.625, 0.18],
  [0.68, 0.135],
  [0.74, 0.1],
  [0.8, 0.072],
  [0.86, 0.05],
  [0.91, 0.033],
  [0.955, 0.018],
  [0.985, 0.008],
  [1, 0],
];

const PROFILE_TANGENTS = makeProfileTangents(PROFILE_POINTS);

function smoothstep(edge0, edge1, value) {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function sign(value) {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function edgeTangent(h0, h1, delta0, delta1) {
  let tangent = ((2 * h0 + h1) * delta0 - h0 * delta1) / (h0 + h1);

  if (sign(tangent) !== sign(delta0)) {
    tangent = 0;
  } else if (sign(delta0) !== sign(delta1) && Math.abs(tangent) > Math.abs(3 * delta0)) {
    tangent = 3 * delta0;
  }

  return tangent;
}

function makeProfileTangents(points) {
  const count = points.length;
  const tangents = new Array(count).fill(0);
  const spans = [];
  const slopes = [];

  for (let i = 0; i < count - 1; i += 1) {
    const span = points[i + 1][0] - points[i][0];
    spans.push(span);
    slopes.push((points[i + 1][1] - points[i][1]) / span);
  }

  tangents[0] = edgeTangent(spans[0], spans[1], slopes[0], slopes[1]);
  tangents[count - 1] = edgeTangent(
    spans[count - 2],
    spans[count - 3],
    slopes[count - 2],
    slopes[count - 3],
  );

  for (let i = 1; i < count - 1; i += 1) {
    const previous = slopes[i - 1];
    const next = slopes[i];

    if (previous * next <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * spans[i] + spans[i - 1];
      const w2 = spans[i] + 2 * spans[i - 1];
      tangents[i] = (w1 + w2) / (w1 / previous + w2 / next);
    }
  }

  return tangents;
}

function interpolateProfile(index, z) {
  const current = PROFILE_POINTS[index];
  const next = PROFILE_POINTS[index + 1];
  const span = next[0] - current[0];
  const t = (z - current[0]) / span;
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return (
    h00 * current[1] +
    h10 * span * PROFILE_TANGENTS[index] +
    h01 * next[1] +
    h11 * span * PROFILE_TANGENTS[index + 1]
  );
}

export function radiusProfile(u) {
  const clamped = Math.min(1, Math.max(0, u));
  const z = clamped * PROFILE_LENGTH;

  if (z <= FRONT_CAP_END) {
    const p = z / FRONT_CAP_END;
    return FRONT_CAP_RADIUS * Math.sqrt(Math.max(0, 1 - Math.pow(1 - p, 2)));
  }

  for (let i = 0; i < PROFILE_POINTS.length - 1; i += 1) {
    const current = PROFILE_POINTS[i];
    const next = PROFILE_POINTS[i + 1];
    if (z >= current[0] && z <= next[0]) {
      return Math.max(0, interpolateProfile(i, z));
    }
  }

  return 0;
}

export function centerline(u) {
  const clamped = Math.min(1, Math.max(0, u));
  const axis = 1.05 + (-1.95 - 1.05) * clamped;
  const bendT = Math.min(1, Math.max(0, (clamped - 0.5) / 0.5));
  const bendEase = Math.pow(bendT, 1.4);
  const neckDip = -0.08 * smoothstep(0.43, NECK_Z, clamped) * (1 - smoothstep(NECK_Z, 0.64, clamped));

  return new Vector3(
    axis * AXIS_SCALE,
    neckDip - 0.4 * bendEase * Math.sin(bendT * Math.PI * 0.7),
    0.02 * Math.sin(Math.PI * clamped) + 0.17 * bendEase * Math.sin(bendT * Math.PI * 0.45),
  );
}

export function tangentAt(u) {
  const delta = 0.0015;
  const a = centerline(Math.max(0, u - delta));
  const b = centerline(Math.min(1, u + delta));
  return b.sub(a).normalize();
}

export function frameAt(u) {
  const tangent = tangentAt(u);
  const reference = Math.abs(tangent.dot(refZ)) < 0.88 ? refZ : refY;
  const normalA = reference.clone().cross(tangent).normalize();
  const normalB = tangent.clone().cross(normalA).normalize();
  return { tangent, normalA, normalB };
}

export function surfacePoint(u, v) {
  const theta = v * Math.PI * 2;
  const { normalA, normalB } = frameAt(u);
  const radial = normalA
    .clone()
    .multiplyScalar(Math.cos(theta))
    .add(normalB.clone().multiplyScalar(Math.sin(theta)));

  return centerline(u).add(radial.multiplyScalar(radiusProfile(u)));
}

export function createTeardropGeometry(
  radialSegments = 88,
  lengthSegments = 220,
  options = {},
) {
  const radiusScale = options.radiusScale ?? 1;
  const minRadius = options.minRadius ?? 0;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= lengthSegments; i += 1) {
    const u = i / lengthSegments;
    const center = centerline(u);
    const radius = Math.max(radiusProfile(u) * radiusScale, minRadius);
    const { normalA, normalB } = frameAt(u);

    for (let j = 0; j <= radialSegments; j += 1) {
      const v = j / radialSegments;
      const theta = v * Math.PI * 2;
      const radial = normalA
        .clone()
        .multiplyScalar(Math.cos(theta))
        .add(normalB.clone().multiplyScalar(Math.sin(theta)));
      const point = center.clone().add(radial.clone().multiplyScalar(radius));

      positions.push(point.x, point.y, point.z);
      normals.push(radial.x, radial.y, radial.z);
      uvs.push(u, v);
    }
  }

  const row = radialSegments + 1;
  for (let i = 0; i < lengthSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + j + 1;
      const d = i * row + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
  return geometry;
}
