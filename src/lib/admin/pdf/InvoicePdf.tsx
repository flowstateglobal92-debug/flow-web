/**
 * The invoice / quotation / credit-note paper as a PDF — the file that goes
 * out by email and comes down from "Download PDF". Same content and order as
 * the HTML sheet (components/admin/invoice/InvoiceDocument.tsx), worked out by
 * the same model (lib/admin/invoice-paper.ts), drawn with @react-pdf's
 * primitives. Sizes are the sheet's pixels × 0.75 (96 dpi → 72 pt).
 *
 * Runs wherever a server action runs: the website's server and the desktop
 * app's main process. Fonts and the brand marks are embedded (generated
 * modules), so there's nothing to find on disk.
 */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { DEFAULT_BRANDING, type Branding, type Business, type DocumentData } from "@/lib/admin/invoice-types";
import { INK, PAPER, formatQty, paperModel, trimNum } from "@/lib/admin/invoice-paper";
import { registerPdfFonts } from "./fonts";
import { MARK_PNG, WORDMARK_INK_PNG, WORDMARK_SIZE } from "./brand.generated";

const MUTED = "#7a6a5c";
const BODY = "#4a3d34";
const SOFT = "#6f6357";
const RULE = "#e3d8ca";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 8.6, color: INK, backgroundColor: PAPER, paddingBottom: 54 },
  caps: { fontFamily: "GeistMono", fontSize: 6.4, letterSpacing: 1.5, textTransform: "uppercase" },
  rule: { height: 0.75, backgroundColor: RULE },
  h2: { fontFamily: "Sora", fontWeight: 400, letterSpacing: -1.2 },
  mono: { fontFamily: "GeistMono" },
  row: { flexDirection: "row" },
});

export function InvoicePdf({
  doc,
  business,
  branding = DEFAULT_BRANDING,
  today,
}: {
  doc: DocumentData;
  business: Business;
  branding?: Branding;
  today: string;
}) {
  registerPdfFonts();
  const p = paperModel(doc, business, branding, today);
  const t = p.totals;
  const c = p.colors;
  const modern = branding.layout === "modern";
  const compact = branding.layout === "compact";
  const padX = modern ? 45 : compact ? 45 : 51;
  const label = { ...s.caps, color: c.deep };
  const items = doc.items.filter((i) => i.description.trim() || Number(i.unit_price) > 0);
  const discountRate = Number(doc.discount_value);
  const cell = compact ? 5.25 : 8.25;

  const logo =
    branding.logo_mode === "custom" && branding.logo_data && /^data:image\/(png|jpeg);/.test(branding.logo_data) ? (
      // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an <img>
      <Image src={branding.logo_data} style={{ maxHeight: 40, maxWidth: 142, objectFit: "contain" }} />
    ) : branding.logo_mode === "none" || (branding.logo_mode === "custom" && !branding.logo_data) ? (
      <Text style={{ ...s.h2, fontSize: 16.5, letterSpacing: -0.5 }}>{business.business_name || "Flow State"}</Text>
    ) : (
      <View style={{ ...s.row, alignItems: "center" }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an <img> */}
        <Image src={MARK_PNG} style={{ height: 30, width: 29.3 }} />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an <img> */}
        <Image src={WORDMARK_INK_PNG} style={{ marginLeft: 10, width: 111, height: (111 * WORDMARK_SIZE.height) / WORDMARK_SIZE.width }} />
      </View>
    );

  return (
    <Document title={`${p.title} ${doc.number ?? "draft"}`} author={business.business_name} creator={business.business_name} producer={business.business_name}>
      <Page size="A4" style={s.page}>
        {/* The accent edge, on every page (classic and compact). */}
        {!modern && <View fixed style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 5.25, backgroundColor: c.accent }} />}

        {modern && (
          <View style={{ ...s.row, justifyContent: "space-between", alignItems: "flex-end", backgroundColor: c.accent, paddingHorizontal: 45, paddingTop: 27, paddingBottom: 18 }}>
            <View>
              <Text style={{ ...s.h2, fontSize: 30, color: c.onAccent }}>{p.title}</Text>
              <Text style={{ ...s.caps, fontSize: 8.25, marginTop: 7, color: c.onAccent }}>{doc.number ?? "Draft · number on issue"}</Text>
            </View>
            <View style={{ backgroundColor: PAPER, paddingHorizontal: 12, paddingVertical: 9 }}>{logo}</View>
          </View>
        )}

        <View style={{ paddingLeft: padX, paddingRight: 45, paddingTop: modern ? 21 : compact ? 22.5 : 31.5 }}>
          {/* Masthead */}
          {!modern && (
            <View style={{ ...s.row, justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ paddingTop: 2 }}>{logo}</View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ ...s.h2, fontSize: compact ? 24 : 31.5 }}>{p.title}</Text>
                <Text style={{ ...s.caps, fontSize: 8.25, marginTop: 7, color: MUTED }}>{doc.number ?? "Draft · number on issue"}</Text>
              </View>
            </View>
          )}
          {!modern && <View style={{ ...s.rule, marginTop: compact ? 12 : 18 }} />}

          {/* Billed to · From · Details */}
          {/* fontSize alongside lineHeight: react-pdf turns a unitless lineHeight into points
              with the same style's fontSize (18 when it has none). */}
          <View style={{ ...s.row, marginTop: modern ? 3 : compact ? 10.5 : 15, gap: 27, color: BODY, fontSize: 8.6, lineHeight: 1.5 }}>
            <View style={{ flex: 1.2 }}>
              <Text style={label}>{p.quote ? "Prepared for" : p.credit ? "Credited to" : "Billed to"}</Text>
              <Text style={{ marginTop: 6, fontSize: 10.1, fontWeight: 500, color: INK }}>{doc.bill_to_name.trim() || "—"}</Text>
              {!!doc.bill_to_company?.trim() && doc.bill_to_company.trim() !== doc.bill_to_name.trim() && (
                <Text style={{ color: INK }}>{doc.bill_to_company.trim()}</Text>
              )}
              {[doc.bill_to_address, doc.bill_to_email, doc.bill_to_phone].filter((x) => x?.trim()).map((x, i) => (
                <Text key={i}>{x!.trim()}</Text>
              ))}
              {!!doc.bill_to_tax_id?.trim() && <Text>TIN {doc.bill_to_tax_id.trim()}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={label}>From</Text>
              <Text style={{ marginTop: 6, fontSize: 10.1, fontWeight: 500, color: INK }}>{business.business_name}</Text>
              {[business.business_address, business.business_email, business.business_phone].filter((x) => x?.trim()).map((x, i) => (
                <Text key={i}>{x!.trim()}</Text>
              ))}
              {!!business.tax_id?.trim() && (
                <Text>
                  {p.taxInvoice ? "TIN" : "Tax ID"} {business.tax_id.trim()}
                </Text>
              )}
            </View>
            <View style={{ flex: 0.85 }}>
              <Text style={label}>Details</Text>
              <View style={{ marginTop: 6 }}>
                {p.details.map(([term, value]) => (
                  <View key={term} style={{ ...s.row, justifyContent: "space-between", marginBottom: 2 }}>
                    <Text style={{ color: MUTED }}>{term}</Text>
                    <Text style={{ ...s.mono, fontSize: 8.25, color: INK }}>{value}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Amount due */}
          <View
            wrap={false}
            style={{
              ...s.row,
              justifyContent: "space-between",
              marginTop: compact ? 12 : 18,
              paddingHorizontal: 21,
              paddingTop: compact ? 9 : 12,
              paddingBottom: compact ? 10.5 : 13.5,
              ...(modern ? { borderWidth: 0.75, borderColor: c.accent } : { backgroundColor: c.accent }),
            }}
          >
            <View>
              <Text style={{ ...s.caps, letterSpacing: 1.7, color: modern ? c.deep : c.onAccent }}>{p.amountLabel}</Text>
              <Text
                style={{
                  ...s.h2,
                  fontSize: compact ? 19.5 : 24,
                  marginTop: 6,
                  color: modern ? c.deep : c.onAccent,
                  textDecoration: p.voided ? "line-through" : "none",
                }}
              >
                {p.money(p.amountValue)}
              </Text>
              <Text style={{ marginTop: 6, color: modern ? BODY : c.onAccent }}>{p.amountLine}</Text>
            </View>
            {p.badge && (
              <Text
                style={{
                  ...s.caps,
                  fontSize: 6.75,
                  letterSpacing: 1.2,
                  alignSelf: "flex-start",
                  paddingHorizontal: 6,
                  paddingVertical: 4,
                  backgroundColor: modern ? c.accent : INK,
                  color: modern ? c.onAccent : "#fdf5ea",
                }}
              >
                {p.badge}
              </Text>
            )}
          </View>

          {!!doc.subject?.trim() && (
            <View style={{ marginTop: compact ? 12 : 18 }}>
              <Text style={label}>{p.quote ? "Proposal" : p.credit ? "About" : "For"}</Text>
              <Text style={{ ...s.h2, fontSize: 12.4, letterSpacing: -0.3, marginTop: 4.5 }}>{doc.subject.trim()}</Text>
            </View>
          )}

          {/* Line items */}
          <View style={{ marginTop: doc.subject?.trim() ? 9 : compact ? 12 : 18 }}>
            <View fixed style={{ ...s.row, borderBottomWidth: 0.75, borderBottomColor: INK, paddingBottom: 7 }}>
              <Text style={{ ...s.caps, color: MUTED, width: 25.5 }}>#</Text>
              <Text style={{ ...s.caps, color: MUTED, flex: 1 }}>Description</Text>
              <Text style={{ ...s.caps, color: MUTED, width: 42, textAlign: "right" }}>Qty</Text>
              <Text style={{ ...s.caps, color: MUTED, width: 84, textAlign: "right" }}>Rate</Text>
              <Text style={{ ...s.caps, color: MUTED, width: 93, textAlign: "right" }}>Amount</Text>
            </View>
            {items.length === 0 ? (
              <Text style={{ paddingVertical: 15, textAlign: "center", color: "#b3a595" }}>No line items.</Text>
            ) : (
              items.map((item, i) => (
                <View key={i} wrap={false} style={{ ...s.row, borderBottomWidth: 0.75, borderBottomColor: RULE, paddingVertical: cell }}>
                  <Text style={{ ...s.mono, fontSize: 7.5, color: "#a89a8b", width: 25.5 }}>{String(i + 1).padStart(2, "0")}</Text>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ fontSize: 9.4, fontWeight: 500 }}>{item.description}</Text>
                    {!!item.details?.trim() && <Text style={{ marginTop: 1.5, fontSize: 8.25, color: SOFT, lineHeight: 1.5 }}>{item.details.trim()}</Text>}
                    {p.showLineTax && (item.taxes?.length ?? 0) > 0 && (
                      <Text style={{ ...s.mono, marginTop: 1.5, fontSize: 7.1, color: MUTED }}>
                        {item.taxes!.map((x) => `${x.name} ${trimNum(Number(x.rate), 3)}%`).join(" · ")}
                      </Text>
                    )}
                  </View>
                  <Text style={{ ...s.mono, width: 42, textAlign: "right", color: BODY }}>{formatQty(item.quantity)}</Text>
                  <Text style={{ ...s.mono, width: 84, textAlign: "right", color: BODY }}>{p.money(Number(item.unit_price) || 0)}</Text>
                  <Text style={{ ...s.mono, width: 93, textAlign: "right" }}>{p.money(t.lines[doc.items.indexOf(item)] ?? 0)}</Text>
                </View>
              ))
            )}
          </View>

          {/* Payment details · totals */}
          <View wrap={false} style={{ ...s.row, marginTop: 15, gap: 30, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              {!!doc.payment_details?.trim() && !p.credit && (
                <View style={{ backgroundColor: "#f3e9dc", paddingHorizontal: 15, paddingVertical: 12 }}>
                  <Text style={label}>{p.quote ? "Payment" : "Payment details"}</Text>
                  <Text style={{ ...s.mono, marginTop: 6, fontSize: 7.9, lineHeight: 1.7 }}>{doc.payment_details.trim()}</Text>
                </View>
              )}
              {p.taxInvoice && p.rate && (
                <View style={{ marginTop: 12, borderWidth: 0.75, borderColor: RULE, paddingHorizontal: 15, paddingVertical: 10 }}>
                  <Text style={label}>In Sri Lankan rupees · at Rs {trimNum(p.rate, 4)}</Text>
                  <View style={{ marginTop: 6 }}>
                    <PdfPair term="Value excluding tax" value={p.lkr(t.net)} />
                    {t.taxes.map((x) => (
                      <PdfPair key={`${x.name}${x.rate}`} term={`${x.name} ${trimNum(x.rate, 3)}%`} value={p.lkr(x.amount)} />
                    ))}
                    <PdfPair term="Total including tax" value={p.lkr(t.total)} />
                  </View>
                </View>
              )}
            </View>
            <View style={{ width: 225, color: BODY }}>
              <PdfPair term="Subtotal" value={p.money(t.subtotal)} />
              {t.discount > 0 && (
                <PdfPair
                  term={`Discount${doc.discount_type === "percent" && discountRate > 0 ? ` (${trimNum(discountRate, 2)}%)` : ""}`}
                  value={`−${p.money(t.discount)}`}
                />
              )}
              {p.inclusive && t.tax > 0 && <PdfPair term="Value before tax" value={p.money(t.net)} />}
              {t.taxes.map((x) => (
                <PdfPair key={`${x.name}${x.rate}${x.compound}`} term={p.taxTerm(x)} value={p.money(x.amount)} />
              ))}
              <View style={{ height: 0.75, backgroundColor: INK, marginVertical: 4.5 }} />
              <View style={{ ...s.row, justifyContent: "space-between", paddingVertical: 2 }}>
                <Text style={{ ...s.h2, fontSize: 10.5, letterSpacing: 0 }}>{p.credit ? "Total credit" : p.taxInvoice ? "Total incl. tax" : "Total"}</Text>
                <Text style={{ ...s.mono, fontSize: 10.1 }}>{p.money(t.total)}</Text>
              </View>
              {!p.quote && !p.credit && p.paid > 0 && <PdfPair term="Paid" value={`−${p.money(p.paid)}`} />}
              {!p.quote && !p.credit && p.credited > 0 && <PdfPair term="Credited" value={`−${p.money(p.credited)}`} />}
              {!p.quote && !p.credit && (
                <View style={{ ...s.row, justifyContent: "space-between", marginTop: 4.5, paddingTop: 6, borderTopWidth: 0.75, borderTopColor: RULE }}>
                  <Text style={{ ...s.h2, fontSize: 10.9, letterSpacing: 0, color: c.deep }}>{p.refund > 0 ? "Refund due" : "Balance due"}</Text>
                  <Text style={{ ...s.h2, fontSize: 14.25, letterSpacing: -0.3, color: c.deep }}>
                    {p.money(p.voided ? 0 : p.refund > 0 ? p.refund : p.balance)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Notes · terms */}
          {(!!doc.notes?.trim() || !!doc.terms?.trim()) && (
            <View wrap={false} style={{ ...s.row, marginTop: compact ? 12 : 18, gap: 30, color: BODY, lineHeight: 1.6, fontSize: 8.25 }}>
              {!!doc.notes?.trim() && (
                <View style={{ flex: 1 }}>
                  <Text style={label}>Notes</Text>
                  <Text style={{ marginTop: 4.5 }}>{doc.notes.trim()}</Text>
                </View>
              )}
              {!!doc.terms?.trim() && (
                <View style={{ flex: 1 }}>
                  <Text style={label}>Terms</Text>
                  <Text style={{ marginTop: 4.5, color: SOFT }}>{doc.terms.trim()}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Footer, on every page */}
        <View fixed style={{ position: "absolute", left: padX, right: 45, bottom: 22 }}>
          <View style={s.rule} />
          <View style={{ ...s.row, justifyContent: "space-between", marginTop: 9, alignItems: "flex-end" }}>
            <Text style={{ ...s.h2, fontSize: 9.4, letterSpacing: -0.1 }}>{p.footerText}</Text>
            <Text
              style={{ ...s.mono, fontSize: 7.1, color: MUTED, letterSpacing: 0.4 }}
              render={({ pageNumber, totalPages }) =>
                [business.business_website, business.business_email].filter(Boolean).join("  ·  ") +
                (totalPages > 1 ? `  ·  ${pageNumber}/${totalPages}` : "")
              }
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}

function PdfPair({ term, value }: { term: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
      <Text>{term}</Text>
      <Text style={{ fontFamily: "GeistMono", color: INK }}>{value}</Text>
    </View>
  );
}
