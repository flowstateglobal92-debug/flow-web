"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { NotificationRow, TeamMember } from "@/lib/admin/types";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_READY } from "@/lib/supabase/env";
import { getTeamDirectory, markAllNotificationsRead, markNotificationsRead } from "@/app/admin/actions/notifications";
import { personName } from "../comments/mentions";
import AlertStack from "./AlertStack";
import { NOTIFICATION_COLUMNS } from "./columns";
import { playChime, readAlertPrefs, showDesktopAlert } from "./prefs";

/**
 * Notification state shared by the bell, the alert stack and the full list.
 *
 * CONTRACT (the Shell depends on these names and props):
 *   <NotificationsProvider userId initial>{children}</NotificationsProvider>
 *   useNotifications() → { items, unread, markRead(id), markAllRead(), people, nameOf(id), loadPeople() }
 *
 * Where rows come from:
 *  - the layout renders the unread count and the latest 20 (`initial`), and
 *    sends a fresh copy on every router.refresh() — re-synced during render;
 *  - Realtime pushes INSERTs on public.notifications for this recipient. RLS
 *    hides a row until its deliver_at, so a scheduled reminder never arrives
 *    over the socket…
 *  - …which is what the 60-second poll is for: it asks for anything delivered
 *    since the last look. Both paths dedupe by id.
 */

export type NotificationsInitial = { unread: number; items: NotificationRow[] };

/** Rows kept for the bell; the full list pages through the server instead. */
const KEEP = 40;
const POLL_MS = 60_000;
/** Look back this far on each poll — covers clock drift between browser and database. */
const POLL_OVERLAP_MS = 10 * 60_000;
const MAX_ALERTS = 3;

type Ctx = {
  items: NotificationRow[];
  unread: number;
  /** Optimistic; never refreshes the route. Ids not in `items` are assumed unread (the full list's rows). */
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Teammates for avatars — loaded on first need. */
  people: TeamMember[];
  nameOf: (id: string | null) => string | null;
  loadPeople: () => void;
};

const NotificationsContext = createContext<Ctx>({
  items: [],
  unread: 0,
  markRead: () => {},
  markAllRead: () => {},
  people: [],
  nameOf: () => null,
  loadPeople: () => {},
});

const at = (iso: string) => Date.parse(iso) || 0;
const newestFirst = (a: NotificationRow, b: NotificationRow) => at(b.deliver_at) - at(a.deliver_at);

/** Realtime can hand timestamps over in Postgres text form ("… 09:00:00+00"); Safari can't parse that. */
function isoTime(v: string | null) {
  if (!v) return v;
  const d = new Date(v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}
const normalize = (r: NotificationRow): NotificationRow => ({
  ...r,
  deliver_at: isoTime(r.deliver_at) ?? r.deliver_at,
  created_at: isoTime(r.created_at) ?? r.created_at,
  read_at: isoTime(r.read_at),
});

/** Server rows win; local rows newer than the server's newest (arrived live) are kept. */
function merge(server: NotificationRow[], local: NotificationRow[]) {
  const ids = new Set(server.map((n) => n.id));
  const newest = server.reduce((max, n) => Math.max(max, at(n.deliver_at)), 0);
  const live = local.filter((n) => !ids.has(n.id) && at(n.deliver_at) > newest);
  return [...live, ...server].sort(newestFirst).slice(0, KEEP);
}

export function NotificationsProvider({
  userId,
  initial,
  children,
}: {
  userId: string;
  initial: NotificationsInitial;
  children: ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [unread, setUnread] = useState(initial.unread);
  const [alerts, setAlerts] = useState<NotificationRow[]>([]);
  const [people, setPeople] = useState<TeamMember[]>([]);

  // The layout re-renders on router.refresh(); adopt its copy (the "adjust
  // state on prop change" pattern, as in crm/Board.tsx).
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setItems(merge(initial.items, items));
    setUnread(initial.unread);
  }

  // Mirrors for the socket and poll callbacks, which outlive any one render.
  const itemsRef = useRef(items);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    itemsRef.current = items;
    for (const n of items) seen.current.add(n.id);
  }, [items]);

  const peopleRequested = useRef(false);
  const loadPeople = useCallback(() => {
    if (peopleRequested.current) return;
    peopleRequested.current = true;
    getTeamDirectory()
      .then(setPeople)
      .catch(() => {
        peopleRequested.current = false;
      });
  }, []);

  const nameOf = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const person = people.find((p) => p.id === id);
      return person ? personName(person) : null;
    },
    [people],
  );

  /** New rows from the socket or the poll: dedupe, count, alert. */
  const receive = useCallback(
    (rows: NotificationRow[]) => {
      const fresh = rows
        .filter((r) => r?.id && !seen.current.has(r.id))
        .map(normalize)
        .sort(newestFirst);
      if (fresh.length === 0) return;
      for (const r of fresh) seen.current.add(r.id);

      setItems((list) => [...fresh, ...list].sort(newestFirst).slice(0, KEEP));
      const unseen = fresh.filter((r) => !r.read_at);
      if (unseen.length === 0) return;
      setUnread((u) => u + unseen.length);
      setAlerts((list) => [...unseen.slice(0, MAX_ALERTS), ...list].slice(0, MAX_ALERTS));
      loadPeople();

      const prefs = readAlertPrefs();
      if (prefs.sound) playChime();
      if (prefs.desktop) for (const r of unseen.slice(0, MAX_ALERTS)) showDesktopAlert(r, (link) => router.push(link));
    },
    [router, loadPeople],
  );

  // Live delivery.
  useEffect(() => {
    if (!SUPABASE_READY || !userId) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let gone = false;

    // Realtime evaluates RLS with the socket's token — keep it current across
    // the hourly refresh, or matching silently stops.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && event === "TOKEN_REFRESHED") void supabase.realtime.setAuth(session.access_token);
    });

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (gone || !session) return;
      await supabase.realtime.setAuth(session.access_token);
      if (gone) return;
      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
          (payload) => receive([payload.new as NotificationRow]),
        )
        .subscribe();
    })();

    return () => {
      gone = true;
      subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, receive]);

  // Scheduled reminders that have matured since the last look.
  useEffect(() => {
    if (!SUPABASE_READY || !userId) return;
    const supabase = createClient();
    let since = Date.now();
    let busy = false;

    const poll = async () => {
      if (busy) return;
      busy = true;
      const started = Date.now();
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select(NOTIFICATION_COLUMNS)
          .gte("deliver_at", new Date(since - POLL_OVERLAP_MS).toISOString())
          .order("deliver_at", { ascending: false })
          .limit(20)
          .returns<NotificationRow[]>();
        if (!error) {
          since = started;
          if (data?.length) receive(data);
        }
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(() => void poll(), POLL_MS);
    // Coming back to the tab (or waking the laptop) checks straight away.
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, receive]);

  const markRead = useCallback((id: string) => {
    const known = itemsRef.current.find((n) => n.id === id);
    if (known?.read_at) return;
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
    setUnread((u) => Math.max(0, u - 1));
    setAlerts((list) => list.filter((n) => n.id !== id));
    void markNotificationsRead([id]);
  }, []);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    setAlerts([]);
    void markAllNotificationsRead();
  }, []);

  const dismiss = useCallback((id: string) => setAlerts((list) => list.filter((n) => n.id !== id)), []);

  const openAlert = useCallback(
    (n: NotificationRow) => {
      markRead(n.id);
      if (n.link) router.push(n.link);
    },
    [markRead, router],
  );

  const value = useMemo(
    () => ({ items, unread, markRead, markAllRead, people, nameOf, loadPeople }),
    [items, unread, markRead, markAllRead, people, nameOf, loadPeople],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <AlertStack alerts={alerts} nameOf={nameOf} onOpen={openAlert} onDismiss={dismiss} />
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
