/**
 * Spent-of-budget bar. The fill carries the state — terra while on track,
 * amber from the alert line, rose past 100% — and the caller always prints
 * the state in words beside it, so colour is never the only signal.
 */
export default function Meter({
  percent,
  alertAt,
  label,
}: {
  percent: number;
  /** Where the warning starts, 1–100 — drawn as a hairline tick. */
  alertAt?: number;
  label: string;
}) {
  const p = Number.isFinite(percent) ? Math.max(0, percent) : 0;
  const tone = p > 100 ? "bg-rose-400" : alertAt !== undefined && p >= alertAt ? "bg-amber-300" : "bg-terra";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
      className="relative h-1.5 w-full bg-cream/[0.07] print:bg-neutral-200"
    >
      <div className={`h-full ${tone}`} style={{ width: `${Math.min(p, 100)}%` }} />
      {alertAt !== undefined && alertAt > 0 && alertAt < 100 && (
        <span className="absolute -top-0.5 h-2.5 w-px bg-cream/45" style={{ left: `${alertAt}%` }} aria-hidden />
      )}
    </div>
  );
}
