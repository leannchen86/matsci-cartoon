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
  // Net surface tension needed to start a crack at a flaw.
  strengthMPa: 90,
  // Peak applied tension (Hertzian ring) at full force, before residual offset.
  maxTensionPeakMPa: 1150,
  forceExponent: 0.7,
  // Contact patch radius in world units at full force.
  contactRadius: 26,
  holdRampSeconds: 2.6,
  releaseDecaySeconds: 0.25
};

export const EXPLOSION = {
  // Real-time seconds for the crack front to consume the whole drop at 1x.
  frontSeconds: 0.5,
  gravity: 420,
  particlesPerFrame: 150,
  lifeMin: 2.2,
  lifeMax: 4.2
};
