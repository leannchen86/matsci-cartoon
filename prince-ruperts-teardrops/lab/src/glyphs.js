import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { radiusAt } from "./geometry.js";
import { clamp } from "./math.js";

// A self-balanced stress field drawn across the cut plane. The interior tension
// core (arrows pushing OUT) and the thin compression skin (arrows pushing IN)
// are locked against each other — frozen stored energy held in static
// equilibrium. The heatmap shows where the stress is; this shows the two halves
// fighting and, on fracture, the balance snapping: as the crack front sweeps
// past, each glyph is released and flung outward, which IS why the drop
// detonates. Arrows are neutral ink; the heatmap underneath carries magnitude.
const FRAME_STEP = 7;
// Two clamp stations near the surface (compression) bracket two expand stations
// in the core (tension); the sign crossover sits near rho ~0.72.
const RHO_STATIONS = [-0.92, -0.35, 0.35, 0.92];
// One arrow per glyph: 1 shaft + 2 head legs.
const SEGMENTS_PER_GLYPH = 3;
const FLOATS_PER_GLYPH = SEGMENTS_PER_GLYPH * 6;
const RELEASE_BAND = 0.06;

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
      const jitterRho = signedRho + (Math.random() - 0.5) * 0.05;
      const point = frame.center.clone()
        .add(frame.normal.clone().multiplyScalar(jitterRho * radius));
      // In-plane scatter direction used when the glyph is released.
      const scatter = frame.normal.clone().multiplyScalar((Math.random() - 0.5) * 1.2)
        .add(frame.tangent.clone().multiplyScalar((Math.random() - 0.5) * 1.2))
        .normalize();
      glyphs.push({
        point,
        normal: frame.normal.clone(), // radial (across the cut)
        axial: frame.tangent.clone(), // along the spine (head legs splay here)
        scatter,
        t: frame.t,
        signedRho: jitterRho,
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
    opacity: 0.85,
    depthTest: false
  });
  material.resolution.set(window.innerWidth, window.innerHeight);

  const object = new LineSegments2(geometry, material);
  object.renderOrder = 6;
  object.frustumCulled = false;
  object.visible = false;

  const origin = new THREE.Vector3();
  const dirVec = new THREE.Vector3();
  const tip = new THREE.Vector3();
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

  // opts: { engaged, contact, p0, contactRadius, time, broken, breakT, frontT }.
  // While intact the field holds in a quivering, locked balance; once broken the
  // crack front (frontT spreading from breakT) releases each glyph in turn.
  function update(opts) {
    const { engaged, contact, p0, contactRadius, time, broken, breakT, frontT } = opts;
    let cursor = 0;

    for (let g = 0; g < glyphs.length; g += 1) {
      const glyph = glyphs[g];
      const sgn = Math.sign(glyph.signedRho) || 1;

      let net = stressModel.sample(glyph.t, glyph.rho);
      if (engaged && p0 > 0) {
        const ring = glyph.point.distanceTo(contact) / contactRadius;
        net += -2.6 * p0 * Math.exp(-ring * ring * 0.7);
      }
      const compression = net < 0;
      const mag = clamp(Math.abs(net) / 650, 0, 1);
      const baseLen = 5 + 15 * mag;
      const release = broken
        ? clamp((frontT - Math.abs(glyph.t - breakT)) / RELEASE_BAND, 0, 1)
        : 0;

      let len;
      let headLen;
      let headW;
      origin.copy(glyph.point);

      if (release <= 0) {
        // Locked: skin (compression) points inward, core (tension) points out;
        // a tight quiver reads as held strain rather than free motion.
        dirVec.copy(glyph.normal).multiplyScalar(compression ? -sgn : sgn);
        len = baseLen * (1 + 0.05 * Math.sin(time * 7 + glyph.phase));
        headLen = 3 + 5 * mag;
        headW = 2 + 3 * mag;
      } else {
        // Released: the balance snaps, everything flings outward and burns out.
        const burst = Math.sin(Math.min(release, 1) * Math.PI); // 0 -> 1 -> 0
        dirVec.copy(glyph.normal).multiplyScalar(sgn);
        origin.addScaledVector(dirVec, release * 34).addScaledVector(glyph.scatter, release * 22);
        len = baseLen + burst * 44;
        headLen = (3 + 5 * mag) * (1 + burst);
        headW = (2 + 3 * mag) * (1 + burst);
        if (release >= 0.97) {
          len = 0;
          headLen = 0;
        }
      }

      tip.copy(origin).addScaledVector(dirVec, len);
      cursor = writeSegment(cursor, origin, tip);
      base.copy(tip).addScaledVector(dirVec, -headLen);
      legA.copy(base).addScaledVector(glyph.axial, headW);
      legB.copy(base).addScaledVector(glyph.axial, -headW);
      cursor = writeSegment(cursor, tip, legA);
      cursor = writeSegment(cursor, tip, legB);
    }

    geometry.setPositions(positions);
  }

  function setResolution(width, height) {
    material.resolution.set(width, height);
  }

  return { object, update, setResolution };
}
