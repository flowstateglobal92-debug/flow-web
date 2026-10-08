import { Font } from "@react-pdf/renderer";
import { GEIST_400, GEIST_500, GEIST_MONO_400, SORA_400, SORA_500 } from "./fonts.generated";

let registered = false;

/** The brand fonts, once per process: Sora (display), Geist (text), Geist Mono (figures). */
export function registerPdfFonts() {
  if (registered) return;
  registered = true;
  Font.register({ family: "Sora", fonts: [{ src: SORA_400, fontWeight: 400 }, { src: SORA_500, fontWeight: 500 }] });
  Font.register({ family: "Geist", fonts: [{ src: GEIST_400, fontWeight: 400 }, { src: GEIST_500, fontWeight: 500 }] });
  Font.register({ family: "GeistMono", fonts: [{ src: GEIST_MONO_400, fontWeight: 400 }] });
  // Documents don't hyphenate.
  Font.registerHyphenationCallback((word) => [word]);
}
