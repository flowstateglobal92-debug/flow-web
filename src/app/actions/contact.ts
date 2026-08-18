"use server";

import { createClient } from "@/lib/supabase/server";
import { SUPABASE_READY } from "@/lib/supabase/env";

export type ContactState = {
  status: "idle" | "sent" | "error";
  error?: string;
  name?: string;
  focus?: string;
  /** Identifies this submission so the form can offer "send another". */
  id?: string;
};

/**
 * Public walkthrough-form submission. Writes straight into `inquiries` through
 * the anon key — RLS allows insert and nothing else (migration 0002), so the
 * form can post but can never read anyone's data back.
 */
export async function submitInquiry(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const name = String(formData.get("name") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const focus = String(formData.get("focus") ?? "").trim();

  // Honeypot: real people leave it empty. Answer as if it worked.
  if (String(formData.get("company_website") ?? "").trim()) {
    return { status: "sent", name, focus, id: crypto.randomUUID() };
  }

  if (!name || !contact) {
    return { status: "error", error: "Add your name and a way to reach you." };
  }

  if (!SUPABASE_READY) {
    return { status: "error", error: "The form isn't connected yet. Please email support@flowstate.lk." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inquiries").insert({
    name,
    business: String(formData.get("business") ?? "").trim() || null,
    contact,
    focus: focus || null,
    message: String(formData.get("message") ?? "").trim() || null,
    source: "website",
    page: String(formData.get("page") ?? "").trim() || null,
  });

  if (error) {
    return { status: "error", error: "We couldn't send that. Please try again, or email support@flowstate.lk." };
  }

  return { status: "sent", name, focus, id: crypto.randomUUID() };
}
