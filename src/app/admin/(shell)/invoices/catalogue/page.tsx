import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import CatalogueScreen from "@/components/admin/invoice/CatalogueScreen";
import { loadCatalogue, loadSettings, loadTaxRates } from "../data";

export const metadata: Metadata = { title: "Catalogue" };

/** Saved products and services — the editor's "From catalogue" list. */
export default async function CataloguePage() {
  const { supabase, profile } = await requireModule("invoices");
  const [items, taxRates, settings] = await Promise.all([
    loadCatalogue(supabase, { all: true }),
    loadTaxRates(supabase),
    loadSettings(supabase, profile.workspace),
  ]);
  return <CatalogueScreen items={items} taxRates={taxRates} baseCurrency={settings.default_currency} />;
}
