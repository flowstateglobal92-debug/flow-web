/**
 * Chart colours. They're CSS variables (globals.css: `:root` for the dark
 * theme, `html[data-theme="cream"]` for cream), so a chart follows the theme
 * without re-rendering. Pass them as `fill`/`stroke` attributes or inline
 * `background`; the `print:` classes on the marks still win over attributes.
 *
 * The dark values were validated against the panel surface (#15100c) with
 * the dataviz checker: income/expense pass lightness, chroma, CVD (ΔE 8.0
 * deutan) and contrast. In cream, income is a deeper green (#15805f) and the
 * line is ink, so both still read on parchment. Lines use the text colour so
 * they never compete with the two hues. Text never wears these — labels stay
 * in cream/sand.
 */
export const CHART = {
  income: "var(--chart-income)",
  expense: "var(--chart-expense)",
  line: "var(--chart-line)",
  /** The surface marks are ringed and gapped with. */
  surface: "var(--chart-surface)",
} as const;

/**
 * Receivables aging, current → 90+: one terra hue that gets stronger as it
 * gets worse — brighter on the dark theme, darker on cream (ordinal check passes).
 */
export const AGING_RAMP = ["var(--aging-1)", "var(--aging-2)", "var(--aging-3)", "var(--aging-4)", "var(--aging-5)"] as const;
