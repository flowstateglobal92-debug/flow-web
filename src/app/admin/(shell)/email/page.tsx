import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { PageHead, Panel } from "@/components/admin/ui";
import { MAILBOX_ADDRESS, MAILBOX_FROM, RESEND_READY } from "@/lib/email/config";
import { getMail, listMail } from "@/lib/email/mailbox";
import { FOLDERS, type MailDetail, type MailDirection, type MailFolder, type MailPage } from "@/lib/email/types";
import Mailbox from "./Mailbox";

export const metadata: Metadata = { title: "Email" };

const isFolder = (value: string): value is MailFolder => FOLDERS.some((f) => f.key === value);

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; q?: string; after?: string; id?: string; dir?: string }>;
}) {
  await requireModule("email");

  const { folder: rawFolder = "inbox", q = "", after, id, dir } = await searchParams;
  const folder: MailFolder = isFolder(rawFolder) ? rawFolder : "inbox";

  if (!RESEND_READY) {
    return (
      <>
        <PageHead eyebrow="Mailbox" title="Email" hint="Send and receive from the company address." />
        <Panel title="Resend isn't connected yet" hint="One environment variable away.">
          <ol className="ml-4 list-decimal space-y-2 text-[12.5px] leading-relaxed text-cream-2 marker:text-terra-bright">
            <li>
              Create an API key at <span className="text-cream">resend.com/api-keys</span> with full access.
            </li>
            <li>
              Add <code className="bg-cream/[0.06] px-1.5 py-0.5 font-mono text-[11.5px]">RESEND_API_KEY</code> to{" "}
              <code className="bg-cream/[0.06] px-1.5 py-0.5 font-mono text-[11.5px]">.env.local</code>, then restart{" "}
              <code className="bg-cream/[0.06] px-1.5 py-0.5 font-mono text-[11.5px]">next dev</code>.
            </li>
            <li>
              Verify <span className="text-cream">{MAILBOX_ADDRESS.split("@")[1]}</span> for sending, and turn on
              receiving so inbound mail reaches this inbox.
            </li>
          </ol>
        </Panel>
      </>
    );
  }

  const page: MailPage = await listMail(folder, { q, after });

  // The reading pane renders on the server too, so opening a message is a plain
  // navigation — no client-side fetching, same as every other admin surface.
  let open: MailDetail | null = null;
  let openError: string | null = null;
  if (id) {
    const direction: MailDirection =
      dir === "outbound" || dir === "inbound"
        ? dir
        : (page.items.find((m) => m.id === id)?.direction ?? "inbound");
    try {
      open = await getMail(id, direction);
    } catch (e) {
      openError = e instanceof Error ? e.message : "That message could not be loaded.";
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Mailbox"
        title="Email"
        hint={`Everything sent from and received at ${MAILBOX_ADDRESS}. Replies thread properly, attachments go both ways.`}
      />
      {page.warnings.length > 0 && (
        <div className="mb-4 border border-amber-300/25 bg-amber-400/[0.07] px-3.5 py-2.5 text-[12px] text-amber-100">
          {page.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <Mailbox
        page={page}
        folder={folder}
        query={q}
        cursor={after ?? ""}
        open={open}
        openError={openError}
        from={MAILBOX_FROM}
        mailbox={MAILBOX_ADDRESS}
      />
    </>
  );
}
