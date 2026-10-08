/**
 * A statement of account as a PDF — same paper, fonts and accent as invoices
 * (InvoicePdf.tsx), the figures client_statement() worked out (0037).
 */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/admin/format";
import { DEFAULT_BRANDING, docMoney, type Branding, type Business } from "@/lib/admin/invoice-types";
import { INK, PAPER, palette } from "@/lib/admin/invoice-paper";
import { LINE_LABEL, type Statement } from "@/lib/admin/statement";
import { MARK_PNG, WORDMARK_INK_PNG, WORDMARK_SIZE } from "./brand.generated";
import { registerPdfFonts } from "./fonts";

const MUTED = "#7a6a5c";
const BODY = "#4a3d34";
const RULE = "#e3d8ca";

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 8.6, color: INK, backgroundColor: PAPER, paddingTop: 31.5, paddingLeft: 51, paddingRight: 45, paddingBottom: 54 },
  caps: { fontFamily: "GeistMono", fontSize: 6.4, letterSpacing: 1.5, textTransform: "uppercase" },
  mono: { fontFamily: "GeistMono" },
  row: { flexDirection: "row" },
  h2: { fontFamily: "Sora", fontWeight: 400, letterSpacing: -1.2 },
});

export function StatementPdf({
  statement: st,
  business,
  branding = DEFAULT_BRANDING,
}: {
  statement: Statement;
  business: Business;
  branding?: Branding;
}) {
  registerPdfFonts();
  const c = palette(branding.accent_color);
  const money = (v: number) => docMoney(v, st.currency);
  const label = { ...s.caps, color: c.deep };
  const owed = st.open.reduce((a, o) => a + o.balance, 0);
  const overdue = st.open.filter((o) => o.days_overdue > 0).reduce((a, o) => a + o.balance, 0);

  const logo =
    branding.logo_mode === "custom" && branding.logo_data && /^data:image\/(png|jpeg);/.test(branding.logo_data) ? (
      // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image
      <Image src={branding.logo_data} style={{ maxHeight: 40, maxWidth: 142, objectFit: "contain" }} />
    ) : branding.logo_mode === "brand" ? (
      <View style={{ ...s.row, alignItems: "center" }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image */}
        <Image src={MARK_PNG} style={{ height: 30, width: 29.3 }} />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- a PDF image */}
        <Image src={WORDMARK_INK_PNG} style={{ marginLeft: 10, width: 111, height: (111 * WORDMARK_SIZE.height) / WORDMARK_SIZE.width }} />
      </View>
    ) : (
      <Text style={{ ...s.h2, fontSize: 16.5, letterSpacing: -0.5 }}>{business.business_name}</Text>
    );

  return (
    <Document title={`Statement · ${st.client.name}`} author={business.business_name} creator={business.business_name} producer={business.business_name}>
      <Page size="A4" style={s.page}>
        <View fixed style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 5.25, backgroundColor: c.accent }} />

        <View style={{ ...s.row, justifyContent: "space-between" }}>
          <View style={{ paddingTop: 2 }}>{logo}</View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ ...s.h2, fontSize: 28 }}>Statement</Text>
            <Text style={{ ...s.caps, fontSize: 8.25, marginTop: 7, color: MUTED }}>
              {formatDate(st.from)} – {formatDate(st.to)}
            </Text>
          </View>
        </View>
        <View style={{ height: 0.75, backgroundColor: RULE, marginTop: 18 }} />

        <View style={{ ...s.row, marginTop: 15, gap: 27, color: BODY, fontSize: 8.6, lineHeight: 1.5 }}>
          <View style={{ flex: 1.2 }}>
            <Text style={label}>Account</Text>
            <Text style={{ marginTop: 6, fontSize: 10.1, fontWeight: 500, color: INK }}>{st.client.name}</Text>
            {!!st.client.company && st.client.company !== st.client.name && <Text style={{ color: INK }}>{st.client.company}</Text>}
            {!!st.client.address && <Text>{st.client.address}</Text>}
            {!!st.client.email && <Text>{st.client.email}</Text>}
            {!!st.client.tax_id && <Text>TIN {st.client.tax_id}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={label}>From</Text>
            <Text style={{ marginTop: 6, fontSize: 10.1, fontWeight: 500, color: INK }}>{business.business_name}</Text>
            {[business.business_address, business.business_email, business.business_phone].filter((x) => x?.trim()).map((x, i) => (
              <Text key={i}>{x!.trim()}</Text>
            ))}
          </View>
          <View style={{ flex: 0.85 }}>
            <Text style={label}>Summary</Text>
            <View style={{ marginTop: 6 }}>
              <Pair term="Brought forward" value={money(st.opening)} />
              <Pair term="Invoiced" value={money(st.period_debit)} />
              <Pair term="Paid & credited" value={`−${money(st.period_credit)}`} />
            </View>
          </View>
        </View>

        <View
          wrap={false}
          style={{ ...s.row, justifyContent: "space-between", marginTop: 18, paddingHorizontal: 21, paddingTop: 12, paddingBottom: 13.5, backgroundColor: c.accent }}
        >
          <View>
            <Text style={{ ...s.caps, letterSpacing: 1.7, color: c.onAccent }}>Balance at {formatDate(st.to)}</Text>
            <Text style={{ ...s.h2, fontSize: 24, marginTop: 6, color: c.onAccent }}>{money(st.closing)}</Text>
            <Text style={{ marginTop: 6, color: c.onAccent }}>
              {overdue > 0 ? `${money(overdue)} of it is overdue.` : st.closing > 0 ? "Nothing is overdue." : "Nothing is owed — thank you."}
            </Text>
          </View>
        </View>

        {/* Movements */}
        <View style={{ marginTop: 18 }}>
          <View fixed style={{ ...s.row, borderBottomWidth: 0.75, borderBottomColor: INK, paddingBottom: 7 }}>
            <Text style={{ ...s.caps, color: MUTED, width: 60 }}>Date</Text>
            <Text style={{ ...s.caps, color: MUTED, flex: 1 }}>Details</Text>
            <Text style={{ ...s.caps, color: MUTED, width: 78, textAlign: "right" }}>Charges</Text>
            <Text style={{ ...s.caps, color: MUTED, width: 78, textAlign: "right" }}>Credits</Text>
            <Text style={{ ...s.caps, color: MUTED, width: 84, textAlign: "right" }}>Balance</Text>
          </View>
          <View style={{ ...s.row, borderBottomWidth: 0.75, borderBottomColor: RULE, paddingVertical: 6 }}>
            <Text style={{ ...s.mono, width: 60, color: MUTED }}>{formatDate(st.from)}</Text>
            <Text style={{ flex: 1, color: BODY }}>Balance brought forward</Text>
            <Text style={{ width: 78 }} />
            <Text style={{ width: 78 }} />
            <Text style={{ ...s.mono, width: 84, textAlign: "right" }}>{money(st.opening)}</Text>
          </View>
          {st.lines.map((l, i) => (
            <View key={i} wrap={false} style={{ ...s.row, borderBottomWidth: 0.75, borderBottomColor: RULE, paddingVertical: 6 }}>
              <Text style={{ ...s.mono, width: 60, color: MUTED }}>{formatDate(l.date)}</Text>
              <Text style={{ flex: 1, paddingRight: 8 }}>
                {LINE_LABEL[l.type]} {l.ref ?? ""}
                {l.detail && l.type !== "credit_note" && l.detail !== "Invoice" ? <Text style={{ color: MUTED }}> · {l.detail}</Text> : null}
              </Text>
              <Text style={{ ...s.mono, width: 78, textAlign: "right", color: BODY }}>{l.debit ? money(l.debit) : ""}</Text>
              <Text style={{ ...s.mono, width: 78, textAlign: "right", color: BODY }}>{l.credit ? money(l.credit) : ""}</Text>
              <Text style={{ ...s.mono, width: 84, textAlign: "right" }}>{money(l.balance)}</Text>
            </View>
          ))}
          <View style={{ ...s.row, paddingVertical: 7 }}>
            <Text style={{ width: 60 }} />
            <Text style={{ ...s.h2, flex: 1, fontSize: 10.1, letterSpacing: 0 }}>Balance carried forward</Text>
            <Text style={{ ...s.h2, width: 84, textAlign: "right", fontSize: 10.1, letterSpacing: 0, color: c.deep }}>{money(st.closing)}</Text>
          </View>
        </View>

        {/* Open invoices */}
        {st.open.length > 0 && (
          <View wrap={false} style={{ marginTop: 18 }}>
            <Text style={label}>Open invoices · {money(owed)}</Text>
            {st.open.map((o) => (
              <View key={o.id} style={{ ...s.row, borderBottomWidth: 0.75, borderBottomColor: RULE, paddingVertical: 5 }}>
                <Text style={{ ...s.mono, width: 90 }}>{o.number ?? "—"}</Text>
                <Text style={{ flex: 1, color: BODY }}>
                  {o.due_date ? `Due ${formatDate(o.due_date)}` : "Due on receipt"}
                  {o.days_overdue > 0 ? ` · ${o.days_overdue} days overdue` : ""}
                </Text>
                <Text style={{ ...s.mono, width: 84, textAlign: "right" }}>{money(o.balance)}</Text>
              </View>
            ))}
          </View>
        )}

        <View fixed style={{ position: "absolute", left: 51, right: 45, bottom: 22 }}>
          <View style={{ height: 0.75, backgroundColor: RULE }} />
          <View style={{ ...s.row, justifyContent: "space-between", marginTop: 9 }}>
            <Text style={{ ...s.h2, fontSize: 9.4, letterSpacing: -0.1 }}>{branding.footer_text?.trim() || "Thank you for your business."}</Text>
            <Text
              style={{ ...s.mono, fontSize: 7.1, color: MUTED }}
              render={({ pageNumber, totalPages }) =>
                [business.business_website, business.business_email].filter(Boolean).join("  ·  ") + (totalPages > 1 ? `  ·  ${pageNumber}/${totalPages}` : "")
              }
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}

function Pair({ term, value }: { term: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
      <Text style={{ color: MUTED }}>{term}</Text>
      <Text style={{ fontFamily: "GeistMono", fontSize: 8.25, color: INK }}>{value}</Text>
    </View>
  );
}
