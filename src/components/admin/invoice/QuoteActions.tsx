"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Button, Checkbox } from "@/components/admin/ui";
import { hrefFor } from "@/lib/admin/links";
import { displayStatus, docLabel, type Invoice } from "@/lib/admin/invoice-types";
import { convertQuote, issueDocument, setQuoteStatus } from "@/app/admin/actions/invoices";
import { linkButton } from "./parts";

type Run = (
  fn: () => Promise<{ ok: boolean; error?: string; message?: string; id?: string }>,
  opts?: { onDone?: (r: { ok: boolean; id?: string }) => void },
) => void;

export type QuoteRow = Pick<
  Invoice,
  "id" | "kind" | "number" | "status" | "lead_id" | "due_date" | "total" | "amount_paid" | "converted_invoice_id" | "valid_until"
>;

/**
 * The next step for a quote: send it, record the answer, convert it.
 * Accepting offers to move the linked lead to Won for people with the CRM.
 */
export default function QuoteActions({
  quote,
  run,
  pending,
  today,
  canCrm,
}: {
  quote: QuoteRow;
  run: Run;
  pending: boolean;
  today: string;
  canCrm: boolean;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [winLead, setWinLead] = useState(true);
  const status = displayStatus(quote, today);
  const offerWin = canCrm && !!quote.lead_id;

  const accept = () =>
    run(() => setQuoteStatus(quote.id, "accepted", { winLead: offerWin && winLead }), {
      onDone: (r) => r.ok && setAccepting(false),
    });

  const convert = () =>
    run(() => convertQuote(quote.id), {
      onDone: (r) => {
        if (r.ok && r.id) router.push(`/admin/invoices/${r.id}/edit`);
      },
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 [&>button]:min-h-9">
        {status === "draft" && (
          <Button variant="primary" disabled={pending} onClick={() => run(() => issueDocument(quote.id))}>
            <Icon.send size={13} /> Mark sent
          </Button>
        )}
        {(status === "sent" || status === "expired") && (
          <>
            <Button disabled={pending} onClick={() => (offerWin ? setAccepting(true) : accept())}>
              <Icon.check size={13} /> Accepted
            </Button>
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                if (confirm(`Mark ${docLabel(quote)} declined?`)) run(() => setQuoteStatus(quote.id, "declined"));
              }}
            >
              Declined
            </Button>
          </>
        )}
        {(status === "sent" || status === "accepted") && (
          <Button variant={status === "accepted" ? "primary" : "ghost"} disabled={pending} onClick={convert}>
            <Icon.receipt size={13} /> Convert to invoice
          </Button>
        )}
        {status === "declined" && (
          <Button variant="quiet" disabled={pending} onClick={() => run(() => setQuoteStatus(quote.id, "sent"))}>
            <Icon.refresh size={13} /> Reopen
          </Button>
        )}
        {status === "converted" && quote.converted_invoice_id && (
          <Link href={hrefFor("invoice", quote.converted_invoice_id) ?? "/admin/invoices"} className={`${linkButton.ghost} min-h-9`}>
            Open invoice <Icon.arrow size={13} />
          </Link>
        )}
      </div>

      <Modal
        open={accepting}
        onClose={() => setAccepting(false)}
        title={`${docLabel(quote)} accepted`}
        hint="Record the client's yes. You can convert it to an invoice next."
      >
        <Checkbox
          checked={winLead}
          onChange={(e) => setWinLead(e.target.checked)}
          label="Move the linked lead to Won"
          hint="Moves the CRM card into your won stage."
        />
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
          <Button type="button" onClick={() => setAccepting(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={pending} onClick={accept}>
            Mark accepted
          </Button>
        </div>
      </Modal>
    </>
  );
}
