"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import Meter from "@/components/admin/charts/Meter";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Checkbox, EmptyState, Field, Input, Notice, Select, Stat } from "@/components/admin/ui";
import { money, moneyShort } from "@/lib/admin/format";
import { periodLabel } from "@/lib/admin/reports";
import { EXPENSE_CATEGORIES } from "@/lib/admin/types";
import { deleteBudget, saveBudget } from "@/app/admin/actions/budgets";

export type BudgetPeriod = "monthly" | "quarterly" | "yearly";

/** A row of the `budget_status` view (0017): approved spend in the current Colombo period. */
export type BudgetRow = {
  id: string;
  category: string;
  period: BudgetPeriod;
  amount: number;
  alert_percent: number;
  active: boolean;
  period_start: string | null;
  period_end: string | null;
  spent: number;
  percent: number;
};

const PERIOD_LABEL: Record<BudgetPeriod, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
const PER_MONTH: Record<BudgetPeriod, number> = { monthly: 1, quarterly: 3, yearly: 12 };

const stateOf = (b: BudgetRow) => (b.percent > 100 ? "over" : b.percent >= b.alert_percent ? "warn" : "ok");

function periodName(b: BudgetRow) {
  if (!b.period_start) return PERIOD_LABEL[b.period];
  const p = b.period === "monthly" ? "month" : b.period === "quarterly" ? "quarter" : "year";
  return periodLabel(p, b.period_start, b.period_end ?? b.period_start);
}

export default function Budgets({ budgets, ready, canEdit }: { budgets: BudgetRow[]; ready: boolean; canEdit: boolean }) {
  const { run, pending, toast } = useAction();
  const [modal, setModal] = useState<{ budget?: BudgetRow } | null>(null);

  const active = budgets.filter((b) => b.active);
  const over = active.filter((b) => stateOf(b) === "over");
  const near = active.filter((b) => stateOf(b) === "warn");
  const monthly = active.reduce((a, b) => a + b.amount / PER_MONTH[b.period], 0);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const id = modal?.budget?.id ?? null;
    run(() => saveBudget(id, fd), { onDone: (r) => r.ok && setModal(null) });
  };

  if (!ready) {
    return (
      <Notice tone="info" title="Budgets aren't set up yet">
        Run the receipts &amp; budgets migration (0017) and they&apos;ll appear here.
      </Notice>
    );
  }

  return (
    <>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Active budgets" value={active.length} sub={`${PERIOD_LABEL.monthly}, quarterly and yearly limits`} icon={<Icon.scale size={15} />} />
        <Stat
          label="Over budget"
          value={over.length}
          sub={near.length ? `${near.length} more near the limit` : "Nothing near its limit"}
          tone={over.length ? "danger" : "neutral"}
          icon={<Icon.flag size={15} />}
        />
        <Stat label="Monthly total" value={moneyShort(monthly)} sub="Quarterly and yearly spread per month" tone="terra" icon={<Icon.down size={15} />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[12px] text-sand">
          Spend counts approved expenses in the current period. Finance users are alerted once at the warning line and once past 100%.
        </p>
        {canEdit && (
          <Button variant="primary" className="min-h-9 sm:min-h-0" data-shortcut="new" onClick={() => setModal({})}>
            <Icon.plus size={13} /> Add budget
          </Button>
        )}
      </div>

      {budgets.length === 0 ? (
        <EmptyState
          title="No budgets yet"
          hint={canEdit ? "Set a monthly limit for a spending category and see how close each one is running." : "An admin sets budgets for spending categories — they'll show here."}
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setModal({})}>
                <Icon.plus size={13} /> Add the first budget
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} canEdit={canEdit} onEdit={() => setModal({ budget: b })} />
          ))}
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.budget ? `Edit ${modal.budget.category}` : "Add budget"}
        hint="One budget per category and period. Category names match the ledger's."
      >
        <form key={modal?.budget?.id ?? "new"} onSubmit={submit} className="space-y-4">
          <Field label="Category" hint="Pick one of the ledger's categories or type your own.">
            <Input name="category" required list="budget-categories" defaultValue={modal?.budget?.category ?? ""} placeholder="Software & subscriptions" />
            <datalist id="budget-categories">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Period">
              <Select name="period" defaultValue={modal?.budget?.period ?? "monthly"}>
                {(Object.keys(PERIOD_LABEL) as BudgetPeriod[]).map((p) => (
                  <option key={p} value={p} className="bg-ink text-cream">
                    {PERIOD_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Limit (Rs)">
              <Input name="amount" type="number" min="1" step="0.01" inputMode="decimal" required defaultValue={modal?.budget?.amount ?? ""} />
            </Field>
            <Field label="Warn at (%)" hint="Alert when spend reaches this share.">
              <Input name="alert_percent" type="number" min="1" max="100" step="1" inputMode="numeric" defaultValue={modal?.budget?.alert_percent ?? 80} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox name="active" label="Active" hint="Paused budgets keep their history but stop alerting." defaultChecked={modal?.budget?.active ?? true} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {modal?.budget && (
              <Button
                type="button"
                variant="danger"
                className="mr-auto min-h-9 sm:min-h-0"
                disabled={pending}
                onClick={() => {
                  const id = modal.budget!.id;
                  if (confirm(`Remove the ${modal.budget!.category} budget?`)) run(() => deleteBudget(id), { onDone: (r) => r.ok && setModal(null) });
                }}
              >
                <Icon.trash size={13} /> Remove
              </Button>
            )}
            <Button type="button" className="min-h-9 sm:min-h-0" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="min-h-9 sm:min-h-0" disabled={pending}>
              {pending ? "Saving…" : modal?.budget ? "Save budget" : "Add budget"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast}
    </>
  );
}

function BudgetCard({ budget: b, canEdit, onEdit }: { budget: BudgetRow; canEdit: boolean; onEdit: () => void }) {
  const state = stateOf(b);
  const word =
    state === "over" ? (
      <span className="text-bad-200">Over by {money(b.spent - b.amount)}</span>
    ) : state === "warn" ? (
      <span className="text-warn-200">Near limit · {Math.round(b.percent)}%</span>
    ) : (
      <span>{Math.round(b.percent)}%</span>
    );

  const body = (
    <>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-sand">
        {PERIOD_LABEL[b.period]} · {b.active ? periodName(b) : "Paused"}
      </p>
      <h3 className="mt-1.5 truncate font-display text-[15px] font-medium text-cream">{b.category}</h3>
      <p className="mt-1 truncate text-[12px] text-sand">
        {money(b.spent)} of {money(b.amount)}
      </p>
      {/* Its own line, never truncated: the meter's colour is never the only signal. */}
      <p className="mt-0.5 text-[12px] text-sand">{word}</p>
      <div className="mt-3">
        <Meter percent={b.percent} alertAt={b.alert_percent} label={`${b.category}: ${Math.round(b.percent)}% of budget used`} />
      </div>
    </>
  );

  // The whole card opens the editor for admins — an overlay button keeps the markup valid.
  return (
    <div
      className={`relative min-w-0 border border-cream/[0.08] surface px-4 py-3.5 transition-colors duration-300 ${
        canEdit ? "hover:border-cream/20" : ""
      } ${b.active ? "" : "opacity-60"}`}
    >
      {body}
      {canEdit && <button type="button" onClick={onEdit} aria-label={`Edit the ${b.category} budget`} className="absolute inset-0" />}
    </div>
  );
}
