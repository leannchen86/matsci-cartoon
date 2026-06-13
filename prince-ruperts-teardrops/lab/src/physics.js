import { PHYSICS } from "./config.js";

// Applied contact stress at the surface: a compressive zone under the
// indenter surrounded by a Hertzian-style tensile ring at the contact edge,
// decaying ~1/d^2 outside. Superposed on the residual field; the drop fails
// where (residual + applied) tension exceeds strength. Mirrored in GLSL in
// materials.js - keep the two in sync.
export function tensionPeak(force01) {
  return PHYSICS.maxTensionPeakMPa * Math.pow(Math.max(force01, 0), PHYSICS.forceExponent);
}

export function contactRadiusAt(force01) {
  return PHYSICS.contactRadius * (0.35 + 0.65 * Math.cbrt(Math.max(force01, 0.0001)));
}

export function appliedSurfaceStress(distance, force01) {
  if (force01 <= 0) {
    return 0;
  }
  const p0 = tensionPeak(force01);
  const a = contactRadiusAt(force01);
  const ring = distance / a;
  const compression = -2.6 * p0 * Math.exp(-ring * ring * 2.2);
  const tension = p0 * (ring < 1 ? ring * ring * ring : 1 / (ring * ring));
  return compression + tension;
}

// Peak net applied tension (occurs near the contact edge).
export function maxAppliedTension(force01) {
  if (force01 <= 0) {
    return 0;
  }
  const a = contactRadiusAt(force01);
  let peak = 0;
  for (let i = 0; i <= 24; i += 1) {
    const d = a * (0.7 + (i / 24) * 0.8);
    peak = Math.max(peak, appliedSurfaceStress(d, force01));
  }
  return peak;
}
