import type { Metadata } from "next";
import Link from "next/link";
import { requireModule } from "@/lib/admin/auth";
import { isApprover } from "@/lib/admin/modules";
import { todayISO } from "@/lib/admin/format";
import { Icon } from "@/components/admin/icons";
import { RouteTabs } from "@/components/admin/Tabs";
import { Notice } from "@/components/admin/ui";
import BusinessSettings from "@/components/admin/invoice/settings/BusinessSettings";
import NumberingSettings from "@/components/admin/invoice/settings/NumberingSettings";
import TaxSettings from "@/components/admin/invoice/settings/TaxSettings";
import BrandingSettings from "@/components/admin/invoice/settings/BrandingSettings";
import EmailSettings from "@/components/admin/invoice/settings/EmailSettings";
import PaymentSettings from "@/components/admin/invoice/settings/PaymentSettings";
import { previewNumbers } from "@/app/admin/actions/billing";
import { loadSettings, loadTaxRates } from "../data";

export const metadata: Metadata = { title: "Invoice settings" };

const TABS = ["business", "numbering", "taxes", "branding", "emails", "payments"] as const;

/**
 * Which providers' keys are on the server — only knowable on the website
 * (NEXT_RUNTIME is Next's); the desktop renders this page without them.
 */
const providerKeys = () =>
  process.env.NEXT_RUNTIME
    ? {
        payhere: Boolean(process.env.PAYHERE_MERCHANT_ID && process.env.PAYHERE_MERCHANT_SECRET),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
        jobs: Boolean(process.env.CRON_SECRET),
      }
    : null;

/** The hourly job ran in the last two hours. */
const ranLately = (iso: string) => Date.now() - Date.parse(iso) < 2 * 3_600_000;
type Tab = (typeof TABS)[number];

/**
 * Everything every new document starts with: the business block, numbering,
 * tax rates and how the paper looks. Admins only — members can read the
 * settings (they print on every invoice) but not change them.
 */
export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireModule("invoices");
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "business";

  if (!isApprover(profile)) {
    return (
      <div className="max-w-xl space-y-4">
        <Notice tone="info" title="Invoice settings are an admin's">
          Ask an admin to change the business details, numbering, tax rates or branding.
        </Notice>
        <Link href="/admin/invoices" className="text-[12px] text-sand hover:text-cream">
          Back to invoices
        </Link>
      </div>
    );
  }

  const [settings, taxRates, numbers, jobs] = await Promise.all([
    loadSettings(supabase, profile.workspace),
    tab === "taxes" ? loadTaxRates(supabase) : Promise.resolve([]),
    tab === "numbering" ? previewNumbers() : Promise.resolve(null),
    // The scheduled job's last run (0038) — a heartbeat in the last two hours means it's set up.
    tab === "emails"
      ? supabase.from("job_runs").select("last_run_at").eq("name", "hourly").maybeSingle<{ last_run_at: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const jobsReady = !!jobs.data && ranLately(jobs.data.last_run_at);

  return (
    <div className="space-y-5">
      <RouteTabs
        tabs={[
          { href: "/admin/invoices/settings?tab=business", label: "Business", icon: <Icon.building size={13} />, param: { key: "tab", value: "business", isDefault: true } },
          { href: "/admin/invoices/settings?tab=numbering", label: "Numbering", icon: <Icon.flag size={13} />, param: { key: "tab", value: "numbering" } },
          { href: "/admin/invoices/settings?tab=taxes", label: "Taxes", icon: <Icon.scale size={13} />, param: { key: "tab", value: "taxes" } },
          { href: "/admin/invoices/settings?tab=branding", label: "Branding", icon: <Icon.image size={13} />, param: { key: "tab", value: "branding" } },
          { href: "/admin/invoices/settings?tab=emails", label: "Emails & reminders", icon: <Icon.mail size={13} />, param: { key: "tab", value: "emails" } },
          { href: "/admin/invoices/settings?tab=payments", label: "Payments", icon: <Icon.receipt size={13} />, param: { key: "tab", value: "payments" } },
        ]}
      />
      {tab === "business" && <BusinessSettings settings={settings} />}
      {tab === "numbering" && <NumberingSettings settings={settings} next={numbers} today={todayISO()} />}
      {tab === "taxes" && <TaxSettings rates={taxRates} registered={!!settings.tax_registered} />}
      {tab === "branding" && <BrandingSettings settings={settings} today={todayISO()} />}
      {tab === "emails" && <EmailSettings settings={settings} jobsReady={jobsReady} />}
      {tab === "payments" && <PaymentSettings settings={settings} keys={providerKeys()} />}
    </div>
  );
}
