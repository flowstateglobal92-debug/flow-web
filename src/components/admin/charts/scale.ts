/** Axis helpers shared by the hand-rolled charts. */

/** Round tick values (0 / 250k / 500k …) covering [min, max], always including 0. */
export function niceTicks(min: number, max: number, count = 4) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** `1.2M`, `340k`, `900` — axis ticks only; tooltips and tables show full amounts. */
export function compact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** A column with a 4px rounded data end and a square baseline; grows up or down. */
export function columnPath(x: number, width: number, base: number, tip: number) {
  const h = Math.abs(tip - base);
  if (h < 0.5) return "";
  const r = Math.min(4, width / 2, h);
  const up = tip < base;
  const y = up ? tip : base;
  if (up) {
    return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${base}Z`;
  }
  const bottom = y + h;
  return `M${x},${base}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + width - r}Q${x + width},${bottom} ${x + width},${bottom - r}V${base}Z`;
}
