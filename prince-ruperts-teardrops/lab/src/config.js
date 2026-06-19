// Drop shape is fixed in the lab; these match the comma-teardrop-3d defaults.
export const SHAPE = {
  headSize: 134,
  headPos: 0.10,
  headSmooth: 0.35,
  tailTaper: 4.60,
  bend: 824,
  hook: 160,
  depth: 145,
  length: 1490,
  quench: 1.10
};

export const PHYSICS = {
  // Net surface tension needed to nucleate a crack at a surface flaw.
  strengthMPa: 90,
  // Peak of the applied Hertzian tensile ring at full force. Set high so a hard
  // press builds a dramatic local gradient AND, at the very top of the range,
  // can finally overcome the head's deep residual compression (~540 MPa) to
  // crack the bulb. The tail (residual ~0) cracks at the lightest touch — same
  // mechanism, vastly less force. maxAppliedTension() ~ 0.71 x this.
  maxTensionPeakMPa: 915,
  // Low exponent => force ramps in fast at the bottom (tail cracks instantly),
  // so the whole upper range is "pressing harder and harder" on the bulb.
  forceExponent: 0.61,
  // Contact patch radius in world units at full force.
  contactRadius: 26,
  holdRampSeconds: 2.6,
  releaseDecaySeconds: 0.25
};

export const EXPLOSION = {
  // Sim-time for the fragmentation front to consume the whole drop. Real Prince
  // Rupert fracture runs at ~1.5 km/s — near-instant — so this is short: the
  // drop bursts almost all at once, with only a faint sweep from the break.
  frontSeconds: 0.12,
  gravity: 420,
  particlesPerFrame: 150,
  lifeMin: 2.2,
  lifeMax: 4.2
};
