import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { radiusAt } from "./geometry.js";
import { clamp } from "./math.js";

// An oriented stress-glyph field drawn on the cut plane. Each glyph is a short
// bar along the spine (the visible principal axis; the hoop partner is
// out-of-plane) with arrow-caps at both ends. Compression squeezes inward
// (caps point in, bar short); tension pulls outward (caps point out, bar long)
// — the directional opposition the heatmap can't show. The arrows are neutral
// ink so they read against the colored heatmap underneath, which carries
// sign/magnitude. The field deepens where you press; mirrors the CUT_PLANE
// applied-stress term in materials.js.
const FRAME_STEP = 7;
const RHO_STATIONS = [-0.9, -0.5, 0, 0.5, 0.9];
// Each glyph is two arrows with a center gap: heads point toward each other
// (compression) or away (tension). Per arrow: 1 shaft + 2 head legs.
const SEGMENTS_PER_GLYPH = 6;
const FLOATS_PER_GLYPH = SEGMENTS_PER_GLYPH * 6;

export function createStressField(params, frames, stressModel) {
  const glyphs = [];

  for (let i = 0; i < frames.length; i += FRAME_STEP) {
    const frame = frames[i];
    const radius = radiusAt(frame.t, params);
    if (radius < 6) {
      continue;
    }
    RHO_STATIONS.forEach((signedRho) => {
      // Irregular placement reads as amorphous glass rather than a crystal.
      const jitterRho = signedRho + (Math.random() - 0.5) * 0.07;
      const point = frame.center.clone()
        .add(frame.normal.clone().multiplyScalar(jitterRho * radius));
      glyphs.push({
        point,
        dir: frame.tangent.clone(),
        perp: frame.normal.clone(),
        t: frame.t,
        rho: Math.abs(jitterRho),
        phase: Math.random() * Math.PI * 2
      });
    });
  }

  const positions = new Float32Array(glyphs.length * FLOATS_PER_GLYPH);
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color: 0x1c1c1c,
    linewidth: 2.0,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  material.resolution.set(window.innerWidth, window.innerHeight);

  const object = new LineSegments2(geometry, material);
  object.renderOrder = 6;
  object.frustumCulled = false;
  object.visible = false;

  const outer = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const headAt = new THREE.Vector3();
  const base = new THREE.Vector3();
  const legA = new THREE.Vector3();
  const legB = new THREE.Vector3();

  function writeSegment(cursor, p0, p1) {
    positions[cursor] = p0.x;
    positions[cursor + 1] = p0.y;
    positions[cursor + 2] = p0.z;
    positions[cursor + 3] = p1.x;
    positions[cursor + 4] = p1.y;
    positions[cursor + 5] = p1.z;
    return cursor + 6;
  }

  // engaged/contact/p0/contactRadius describe the current applied press;
  // time drives a gentle breathing so the opposition reads as motion.
  function update(engaged, contact, p0, contactRadius, time) {
    let cursor = 0;
    for (let g = 0; g < glyphs.length; g += 1) {
      const glyph = glyphs[g];
      const { dir, perp } = glyph;
      let net = stressModel.sample(glyph.t, glyph.rho);
      if (engaged && p0 > 0) {
        const ring = glyph.point.distanceTo(contact) / contactRadius;
        net += -2.6 * p0 * Math.exp(-ring * ring * 0.7);
      }

      const strain = clamp(net / 650, -1, 1); // signed: <0 squeeze, >0 stretch
      const mag = Math.abs(strain);
      const tension = net >= 0;
      // Tension stretches the pair apart, compression draws it in; breathing
      // reinforces the same opposition as motion.
      const rest = 23;
      const breathe = 1 + 0.08 * Math.sin(time * 2.2 + glyph.phase) * (tension ? 1 : -1);
      const half = rest * 0.5 * (1 + 0.5 * strain) * breathe;
      const gap = 3;
      const headLen = 4 + 5 * mag;
      const headW = 2.6 + 3 * mag;

      // Two arrows, one on each side of the center gap.
      for (let s = 1; s >= -1; s -= 2) {
        outer.copy(glyph.point).addScaledVector(dir, s * half);
        inner.copy(glyph.point).addScaledVector(dir, s * gap);
        cursor = writeSegment(cursor, inner, outer);

        // Tension: head at the outer tip pointing out. Compression: head at
        // the inner tip pointing in toward the center.
        let headSign;
        if (tension) {
          headAt.copy(outer);
          headSign = s;
        } else {
          headAt.copy(inner);
          headSign = -s;
        }
        base.copy(headAt).addScaledVector(dir, -headSign * headLen);
        legA.copy(base).addScaledVector(perp, headW);
        legB.copy(base).addScaledVector(perp, -headW);
        cursor = writeSegment(cursor, headAt, legA);
        cursor = writeSegment(cursor, headAt, legB);
      }
    }
    geometry.setPositions(positions);
  }

  function setResolution(width, height) {
    material.resolution.set(width, height);
  }

  return { object, update, setResolution };
}
