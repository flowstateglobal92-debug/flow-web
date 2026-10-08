import type { Metadata } from "next";
import { requireUser } from "@/lib/admin/auth";
import { PageHead } from "@/components/admin/ui";
import TimeOffPanel from "@/components/admin/timeoff/TimeOffPanel";
import NotificationPrefs from "@/components/admin/notifications/NotificationPrefs";
import AppearancePrefs from "@/components/admin/theme/AppearancePrefs";
import AppUpdates from "@/components/admin/AppUpdates";
import DesktopPrefs from "@/components/admin/DesktopPrefs";
import { ROLE_LABEL } from "@/lib/admin/types";
import AccountForms from "./AccountForms";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const { profile } = await requireUser();
  const demo = profile.workspace === "demo";

  return (
    <>
      <PageHead
        eyebrow={demo ? "Demo · My account" : `My account · ${ROLE_LABEL[profile.role]}`}
        title={profile.full_name || profile.email}
        hint="Your profile, password, leave, how alerts reach you and how Flow State looks."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <AccountForms
            fullName={profile.full_name ?? ""}
            title={profile.title ?? ""}
            email={profile.email}
            demo={demo}
          />
          <AppearancePrefs />
          {/* The desktop app's own settings (Quick capture, App lock); nothing on the website. */}
          <DesktopPrefs />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div id="time-off" className="scroll-mt-24">
            <TimeOffPanel
              profile={{
                id: profile.id,
                email: profile.email,
                full_name: profile.full_name,
                role: profile.role,
                permissions: profile.permissions,
                workspace: profile.workspace,
                is_active: profile.is_active,
                title: profile.title,
              }}
            />
          </div>
          <NotificationPrefs />
          <AppUpdates />
        </div>
      </div>
    </>
  );
}
