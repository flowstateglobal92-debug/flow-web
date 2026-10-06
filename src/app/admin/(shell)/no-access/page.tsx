import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/admin/auth";
import { EmptyState, PageHead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "No modules yet" };

/** Where a member lands when no module has been ticked for them yet. */
export default async function NoAccessPage() {
  const { profile } = await requireUser();
  return (
    <>
      <PageHead eyebrow="Access" title={`Welcome, ${profile.full_name || profile.email}`} />
      <EmptyState
        title="No modules have been opened for you yet"
        hint="Your account is active, but the super admin hasn't given you access to any part of the control room. Ask them to tick the modules you need in Team & Users."
        action={
          <Link href="/admin/account" className="text-[12px] text-terra-bright underline-offset-4 hover:underline">
            Go to My account
          </Link>
        }
      />
    </>
  );
}
