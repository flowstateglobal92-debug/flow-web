"use server";

import { revalidatePath } from "next/cache";
import { authorizeUser } from "@/lib/admin/auth";
import { isApprover } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import {
  TIME_OFF_COLUMNS,
  TIME_OFF_TYPES,
  type TimeOffDetailData,
  type TimeOffList,
  type TimeOffRow,
  type TimeOffType,
} from "@/components/admin/timeoff/timeoff";
import { fail, mustAffect, ok, optional, text, type ActionResult } from "./shared";

/**
 * Leave (0019). Anyone active may request their own — it isn't a module, the
 * way My account isn't. Admins can add it for anyone. Whether a member's
 * request needs sign-off is the database's call (workspaces.leave_requires_
 * approval): it forces 'pending' and opens an approval request.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function revalidate() {
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/account");
  revalidatePath("/admin/workload");
  revalidatePath("/admin");
}

/** A missing table means 0019 hasn't run — say so instead of quoting Postgres. */
function friendly(e: unknown) {
  const msg = fail(e).error ?? "";
  return /does not exist|schema cache/i.test(msg) ? "Time off isn't set up yet (migration 0019)." : msg;
}

const nameOf = (p: { full_name: string | null; email: string } | null | undefined) =>
  p ? p.full_name || p.email.split("@")[0] : null;

/** Your own leave, newest first — plus the team when you may add leave for others. */
export async function loadTimeOff(): Promise<TimeOffList> {
  try {
    const { supabase, profile } = await authorizeUser();
    const [{ data, error }, team] = await Promise.all([
      supabase
        .from("time_off")
        .select(TIME_OFF_COLUMNS)
        .eq("user_id", profile.id)
        .order("starts_on", { ascending: false })
        .limit(40)
        .returns<TimeOffRow[]>(),
      isApprover(profile) ? loadTeam(supabase) : Promise.resolve([]),
    ]);
    if (error) throw error;
    return {
      ok: true,
      items: data ?? [],
      people: team.map((m) => ({ id: m.id, full_name: m.full_name, email: m.email })),
    };
  } catch (e) {
    return { ok: false, error: friendly(e), items: [], people: [] };
  }
}

export async function getTimeOff(id: string): Promise<TimeOffDetailData> {
  const empty: TimeOffDetailData = {
    ok: false,
    row: null,
    person: null,
    decider: null,
    canCancel: false,
    canDelete: false,
    isApprover: false,
  };
  try {
    const { supabase, profile } = await authorizeUser();
    const { data: row, error } = await supabase
      .from("time_off")
      .select(TIME_OFF_COLUMNS)
      .eq("id", id)
      .maybeSingle<TimeOffRow>();
    if (error) throw error;
    if (!row) return { ...empty, error: "That leave entry is gone, or you can't see it." };

    const ids = [row.user_id, row.decided_by].filter(Boolean) as string[];
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null; email: string }[]>();
    const find = (uid: string | null) => nameOf((people ?? []).find((p) => p.id === uid));

    const admin = isApprover(profile);
    const mine = row.user_id === profile.id;
    const live = row.status === "pending" || row.status === "approved";
    return {
      ok: true,
      row,
      person: find(row.user_id) ?? "Someone",
      decider: find(row.decided_by),
      // Mirrors the 0019 policies: members cancel their own pending request; admins anything live.
      canCancel: (mine && row.status === "pending") || (admin && live),
      canDelete: admin || (mine && row.status === "pending"),
      isApprover: admin,
    };
  } catch (e) {
    return { ...empty, error: friendly(e) };
  }
}

export async function requestTimeOff(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();

    const userId = optional(formData, "user_id") ?? profile.id;
    if (userId !== profile.id && !isApprover(profile)) {
      return { ok: false, error: "Only an admin can add leave for someone else." };
    }

    const type = text(formData, "type") as TimeOffType;
    const startsOn = text(formData, "starts_on");
    const endsOn = text(formData, "ends_on") || startsOn;
    const half = text(formData, "half_day");
    if (!TIME_OFF_TYPES.includes(type)) return { ok: false, error: "Pick a type of leave." };
    if (!DAY.test(startsOn) || !DAY.test(endsOn)) return { ok: false, error: "Pick the dates." };
    if (endsOn < startsOn) return { ok: false, error: "The last day is before the first." };
    // Half days only make sense for a single day.
    const halfDay = startsOn === endsOn && (half === "am" || half === "pm") ? half : null;

    const { data, error } = await supabase
      .from("time_off")
      .insert({ user_id: userId, type, starts_on: startsOn, ends_on: endsOn, half_day: halfDay, note: optional(formData, "note") })
      .select("id, status")
      .single<{ id: string; status: string }>();
    if (error) throw error;

    revalidate();
    return ok(
      data.status === "pending" ? "Requested — an admin will approve it." : "Added to the calendar.",
      data.id,
    );
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function cancelTimeOff(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorizeUser();
    const { data, error } = await supabase
      .from("time_off")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    mustAffect(data, "You can only cancel a request that's still pending.");
    revalidate();
    return ok("Leave cancelled.");
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function deleteTimeOff(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorizeUser();
    const { data, error } = await supabase.from("time_off").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data, "Only an admin can remove leave once it's decided.");
    revalidate();
    return ok("Leave removed.");
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
