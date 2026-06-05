export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

export function computeStressModel({
  impactU,
  force,
  contactRadius,
  temperature,
}) {
  const tailness = smoothstep(0.42, 0.96, impactU);
  const bulbness = 1 - tailness;
  const contactGain = 0.65 + (0.5 - contactRadius) * 2.35;
  const anneal = smoothstep(430, 620, temperature);
  const surfaceCompression = clamp(100 - anneal * 68, 12, 100);
  const storedTension = clamp(88 - anneal * 76, 6, 88);
  const fractureThreshold = 170 * bulbness + 24 * tailness;
  const applied = force * contactGain * (0.72 + tailness * 1.55);
  const risk = clamp((applied / Math.max(12, fractureThreshold)) * 100, 0, 180);

  let state = "Stable";
  if (risk >= 125) state = "Fracture wave";
  else if (risk >= 88) state = "Critical";
  else if (risk >= 55) state = "Loaded";

  const region =
    impactU < 0.34 ? "bulb shell" : impactU < 0.5 ? "pinched neck" : "filament tail";

  return {
    risk,
    state,
    region,
    tailness,
    surfaceCompression,
    storedTension,
    anneal,
    fact:
      anneal > 0.55
        ? "High heat lets the glass relax, reducing the locked-in Rupert stress."
        : region === "filament tail"
          ? "The filament is the trigger: a tiny crack can reach the tensile core and unload the whole bead."
          : "The bulb survives because its quenched outer skin is locked in compression, which resists crack opening.",
  };
}

export function responsePath(risk, seed = 0) {
  const width = 320;
  const height = 54;
  const mid = height * 0.52;
  const points = [];
  const fracture = risk > 100;
  const amp = fracture ? 19 : 9 + risk * 0.05;

  for (let i = 0; i <= 72; i += 1) {
    const t = i / 72;
    const wave = Math.sin(t * Math.PI * (fracture ? 9.5 : 5.2) + seed * 0.004);
    const envelope = fracture
      ? smoothstep(0.08, 0.42, t) * (1 - smoothstep(0.86, 1, t))
      : Math.exp(-t * 2.4);
    const shock = fracture && t > 0.48 ? Math.sin(t * Math.PI * 24) * 4 : 0;
    points.push(`${(t * width).toFixed(1)},${(mid - wave * amp * envelope - shock).toFixed(1)}`);
  }

  return `M ${points.join(" L ")}`;
}
