export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function sampleArray(values, t) {
  const scaled = clamp(t, 0, 1) * (values.length - 1);
  const index = Math.floor(scaled);
  const nextIndex = Math.min(index + 1, values.length - 1);
  return lerp(values[index], values[nextIndex], scaled - index);
}
