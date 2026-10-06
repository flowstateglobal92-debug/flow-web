/**
 * Chart colours, validated against the panel surface (#15100c, dark) with the
 * dataviz checker: income/expense pass lightness, chroma, CVD (ΔE 8.0 deutan)
 * and contrast. Lines use cream so they never compete with the two hues.
 * Text never wears these — labels stay in cream/sand.
 */
export const CHART = {
  income: "#16a37a",
  expense: "#c65d3b",
  line: "#f3e9dc",
  /** The surface marks are ringed and gapped with. */
  surface: "#15100c",
} as const;

/** Receivables aging, current → 90+: one terra hue, brighter as it gets worse (ordinal check passes). */
export const AGING_RAMP = ["#7a3520", "#9c4428", "#c65d3b", "#e0784f", "#f0a283"] as const;
