"use client";

import type { ReactNode } from "react";
import { Panel } from "../ui";
import {
  APPEARANCE_HINT,
  CAN_SET_DENSITY,
  CAN_SET_TEXT_SIZE,
  TEXT_SIZE_HINT,
  useDensity,
  useTextSize,
  useThemePref,
  writeDensity,
  writeTextSize,
  writeThemePref,
  type Density,
  type TextSize,
  type ThemePref,
} from "./prefs";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "cream", label: "Cream" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Follow system" },
];

const SIZES: { value: TextSize; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "larger", label: "Larger" },
  { value: "largest", label: "Largest" },
];

const DENSITIES: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

/** A compact segmented control: one row, the current choice lit. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-8 border px-3 py-1.5 text-[12px] font-medium transition-colors duration-300 ${i ? "-ml-px" : ""} ${
            value === o.value
              ? "relative z-[1] border-terra/50 bg-terra/15 text-terra-bright"
              : "border-cream/12 bg-cream/[0.03] text-sand hover:text-cream"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One setting per line: what it is on the left, the choice on the right (stacked when narrow). */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-[180px]">
        <p className="text-[12.5px] text-cream-2">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-sand/80">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** My account › Appearance: the theme, and on the desktop app the text size and density. Applies at once. */
export default function AppearancePrefs() {
  const theme = useThemePref();
  const size = useTextSize();
  const density = useDensity();

  return (
    <Panel title="Appearance" hint={APPEARANCE_HINT}>
      <div className="flex flex-col gap-3.5">
        <Row label="Theme" hint="Cream is the light, warm look. Follow system matches this device.">
          <Choice label="Theme" value={theme} options={THEMES} onChange={writeThemePref} />
        </Row>
        {CAN_SET_TEXT_SIZE && (
          <Row label="Text size" hint={TEXT_SIZE_HINT || undefined}>
            <Choice label="Text size" value={size} options={SIZES} onChange={writeTextSize} />
          </Row>
        )}
        {CAN_SET_DENSITY && (
          <Row label="Density" hint="Compact fits more rows on screen, for long lists. Also in the View menu.">
            <Choice label="Density" value={density} options={DENSITIES} onChange={writeDensity} />
          </Row>
        )}
      </div>
    </Panel>
  );
}
