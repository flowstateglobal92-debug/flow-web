"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Field, Input, Panel } from "@/components/admin/ui";
import {
  DOCUMENT_LAYOUTS,
  brandingFrom,
  businessFrom,
  type Branding,
  type DocumentData,
  type DocumentLayout,
  type InvoiceSettings,
  type LogoMode,
} from "@/lib/admin/invoice-types";
import { addDays } from "@/lib/admin/format";
import { saveBranding } from "@/app/admin/actions/billing";
import InvoiceDocument from "../InvoiceDocument";
import ScaledSheet from "../ScaledSheet";

const ACCENTS = [
  { name: "Terracotta", hex: "#C65D3B" },
  { name: "Charcoal", hex: "#2B2622" },
  { name: "Ocean", hex: "#1F5F8B" },
  { name: "Forest", hex: "#2F6B4F" },
  { name: "Plum", hex: "#6B3B5C" },
  { name: "Ochre", hex: "#B08A2E" },
];

const LOGO_MODES: { value: LogoMode; label: string }[] = [
  { value: "brand", label: "Flow State mark" },
  { value: "custom", label: "Your logo" },
  { value: "none", label: "Name only" },
];

/**
 * A logo file → a PNG data URL small enough to keep on the settings row:
 * scaled to fit 640 × 220 (and smaller again if it's still heavy). PNG,
 * because PDF makers read PNG and JPEG but not WebP, and logos need
 * transparency.
 */
async function logoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't an image the browser can read."));
      i.src = url;
    });
    let box = { w: 640, h: 220 };
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, box.w / img.naturalWidth, box.h / img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/png");
      if (data.length <= 400_000) return data;
      box = { w: Math.round(box.w * 0.75), h: Math.round(box.h * 0.75) };
    }
    throw new Error("That logo is too detailed to keep — try a simpler or smaller file.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Logo, accent colour, layout and footer — with the paper beside it, live. */
export default function BrandingSettings({ settings, today }: { settings: InvoiceSettings; today: string }) {
  const { run, pending, toast } = useAction();
  const saved = brandingFrom(settings);
  const [b, setB] = useState<Branding>(saved);
  const [logoChanged, setLogoChanged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setB((x) => ({ ...x, [k]: v }));

  const sample = useMemo<DocumentData>(
    () => ({
      kind: "invoice",
      number: "INV-0042",
      status: "issued",
      bill_to_name: "Nadeesha Perera",
      bill_to_company: "Kite Interiors (Pvt) Ltd",
      bill_to_email: "accounts@kite.lk",
      bill_to_phone: null,
      bill_to_address: "12 Galle Road\nColombo 03",
      subject: "Website redesign — phase 2",
      issue_date: today,
      due_date: addDays(today, 14),
      valid_until: null,
      currency: "LKR",
      discount_type: "amount",
      discount_value: 0,
      tax_label: "VAT",
      tax_rate: 0,
      notes: null,
      terms: null,
      payment_details: settings.payment_details,
      items: [
        { description: "Design sprint", details: "Discovery, wireframes and two rounds of revisions", quantity: 1, unit_price: 180000, taxes: [] },
        { description: "Build", details: null, quantity: 40, unit_price: 6500, taxes: [] },
      ],
      amount_paid: 0,
      paid_at: null,
    }),
    [settings.payment_details, today],
  );

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setProblem(null);
    try {
      const data = await logoDataUrl(f);
      setB((x) => ({ ...x, logo_data: data, logo_mode: "custom" }));
      setLogoChanged(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That file couldn't be used.");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <Panel title="Logo">
          <div className="space-y-3">
            <div className="grid grid-cols-3 border border-cream/12" role="radiogroup" aria-label="Logo">
              {LOGO_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={b.logo_mode === m.value}
                  onClick={() => (m.value === "custom" && !b.logo_data ? file.current?.click() : set("logo_mode", m.value))}
                  className={`min-h-9 px-2 text-[12px] transition-colors ${b.logo_mode === m.value ? "bg-terra/15 text-terra-bright" : "text-sand hover:text-cream"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {b.logo_data && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.logo_data} alt="Your logo" className="max-h-12 max-w-[180px] border border-cream/10 bg-[#fbf7f1] object-contain p-1.5" />
              )}
              <Button type="button" onClick={() => file.current?.click()} className="min-h-9">
                <Icon.upload size={13} /> {b.logo_data ? "Replace" : "Upload logo"}
              </Button>
              {b.logo_data && (
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setB((x) => ({ ...x, logo_data: null, logo_mode: x.logo_mode === "custom" ? "brand" : x.logo_mode }));
                    setLogoChanged(true);
                  }}
                  className="min-h-9"
                >
                  Remove
                </Button>
              )}
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-[11px] text-sand/80">PNG with a transparent background looks best. It&apos;s scaled down to keep documents light.</p>
            {problem && <p className="text-[12px] text-bad-300">{problem}</p>}
          </div>
        </Panel>

        <Panel title="Accent colour" hint="The edge, the amount block and the labels.">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                type="button"
                onClick={() => set("accent_color", a.hex)}
                aria-label={a.name}
                aria-pressed={b.accent_color.toUpperCase() === a.hex}
                title={a.name}
                className={`h-9 w-9 border transition-transform ${b.accent_color.toUpperCase() === a.hex ? "scale-110 border-cream" : "border-cream/15"}`}
                style={{ backgroundColor: a.hex }}
              />
            ))}
            <label className="flex min-h-9 items-center gap-2 border border-cream/12 px-2 text-[12px] text-cream-2">
              <input
                type="color"
                value={b.accent_color}
                onChange={(e) => set("accent_color", e.target.value.toUpperCase())}
                className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                aria-label="Custom accent colour"
              />
              <span className="font-mono">{b.accent_color.toUpperCase()}</span>
            </label>
          </div>
        </Panel>

        <Panel title="Layout">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Layout">
            {DOCUMENT_LAYOUTS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={b.layout === l.value}
                onClick={() => set("layout", l.value as DocumentLayout)}
                className={`border px-3 py-2.5 text-left transition-colors ${b.layout === l.value ? "border-terra/50 bg-terra/10" : "border-cream/12 hover:border-cream/30"}`}
              >
                <span className={`block text-[12.5px] ${b.layout === l.value ? "text-terra-bright" : "text-cream"}`}>{l.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-sand">{l.hint}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Footer line" hint="Replaces “Thank you for your business.” Leave empty for the default.">
          <Field label="Footer">
            <Input value={b.footer_text ?? ""} onChange={(e) => set("footer_text", e.target.value)} maxLength={500} />
          </Field>
        </Panel>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => { setB(saved); setLogoChanged(false); }} disabled={pending} className="min-h-9">
            Reset
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(() =>
                saveBranding({
                  logo_mode: b.logo_mode,
                  logo_data: logoChanged ? b.logo_data : undefined,
                  accent_color: b.accent_color,
                  document_layout: b.layout,
                  footer_text: b.footer_text,
                }),
                { onDone: (r) => r.ok && setLogoChanged(false) },
              )
            }
            className="min-h-9"
          >
            Save branding
          </Button>
        </div>
      </div>

      <aside className="min-w-0" aria-label="Preview">
        <div className="sticky top-6">
          <p className="eyebrow mb-2.5 text-[9.5px]">Preview</p>
          <ScaledSheet fitHeight offset={84}>
            <InvoiceDocument doc={sample} business={businessFrom(settings)} branding={b} today={today} />
          </ScaledSheet>
        </div>
      </aside>
      {toast}
    </div>
  );
}
