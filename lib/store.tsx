"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isPoolLocked, validateSelections } from "@/lib/pool";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  AppState,
  AuthResult,
  Golfer,
  Pool,
  PoolEntry,
  TeamSelection,
  Tier,
  Tournament,
  User,
} from "@/lib/types";
import { createJoinCode } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreatePoolInput = {
  name: string;
  tournamentId: string;
  lockAt: string;
  tiers: Tier[];
};

type AppContextValue = {
  state: AppState;
  currentUser: User | null;
  isReady: boolean;
  register: (userName: string, email: string) => Promise<AuthResult>;
  login: (email: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  createPool: (input: CreatePoolInput) => Promise<Pool | null>;
  joinPool: (joinCode: string) => Promise<Pool | null>;
  updatePoolTiers: (poolId: string, tiers: Tier[]) => Promise<void>;
  inviteEmails: (poolId: string, emails: string[]) => Promise<void>;
  saveEntry: (poolId: string, selections: TeamSelection[], submit: boolean) => Promise<PoolEntry | null>;
  importTournamentFeed: (tournament: Tournament, golfers: Golfer[]) => Promise<void>;
  refreshGolfers: (tournamentId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Remote row types (Supabase snake_case → camelCase mapping)
// ---------------------------------------------------------------------------

type RemoteTournamentRow = {
  id: string;
  name: string;
  course: string;
  start_date: string;
  status: Tournament["status"];
  purse: string;
  source: Tournament["source"] | null;
  source_url: string | null;
  odds_source_url: string | null;
  import_meta: Tournament["importMeta"] | null;
  scores_updated_at: string | null;
};

type RemoteGolferRow = {
  id: string;
  tournament_id: string;
  name: string;
  odds_american: number;
  implied_probability: number;
  current_score_to_par: number;
  position: string;
  made_cut: boolean;
  rounds_complete: number;
};

type JoinedPoolRow = {
  id: string;
  name: string;
  tournament_id: string;
  admin_user_id: string;
  join_code: string;
  invited_emails: string[] | null;
  created_at: string;
  lock_at: string;
  tiers: Tier[] | null;
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapTournamentRow(row: RemoteTournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    course: row.course,
    startDate: row.start_date,
    status: row.status,
    purse: row.purse,
    source: row.source ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    oddsSourceUrl: row.odds_source_url ?? undefined,
    importMeta: row.import_meta ?? null,
  };
}

function mapGolferRow(row: RemoteGolferRow): Golfer {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    oddsAmerican: row.odds_american,
    impliedProbability: row.implied_probability,
    currentScoreToPar: row.current_score_to_par,
    position: row.position,
    madeCut: row.made_cut,
    roundsComplete: row.rounds_complete,
  };
}

function existingSubmittedAt(entries: PoolEntry[], poolId: string, userId: string): string | null {
  return entries.find((e) => e.poolId === poolId && e.userId === userId)?.submittedAt ?? null;
}

const EMPTY_STATE: AppState = {
  users: [],
  currentUserId: null,
  tournaments: [],
  golfers: [],
  pools: [],
  entries: [],
  scoresLastSyncedAt: null,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [isReady, setIsReady] = useState(false);

  // -------------------------------------------------------------------------
  // Core data loader — fetches everything the current user can see
  // -------------------------------------------------------------------------
  const loadState = useCallback(async () => {
    setIsReady(false);

    const supabase = await getSupabaseBrowserClient();

    const [
      { data: authData },
      profilesResult,
      tournamentsResult,
      golfersResult,
      poolsResult,
      membershipsResult,
      entriesResult,
    ] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("id,email,user_name,created_at"),
      supabase
        .from("tournaments")
        .select("id,name,course,start_date,status,purse,source,source_url,odds_source_url,import_meta,scores_updated_at"),
      supabase
        .from("golfers")
        .select(
          "id,tournament_id,name,odds_american,implied_probability,current_score_to_par,position,made_cut,rounds_complete",
        ),
      supabase.from("pools").select("id,name,tournament_id,admin_user_id,join_code,invited_emails,created_at,lock_at,tiers"),
      supabase.from("pool_members").select("pool_id,user_id"),
      supabase.from("pool_entries").select("id,pool_id,user_id,selections,submitted_at"),
    ]);

    const users: User[] =
      profilesResult.data?.map((p) => ({
        id: p.id,
        email: p.email,
        userName: p.user_name,
        createdAt: p.created_at,
      })) ?? [];

    const pools: Pool[] =
      poolsResult.data?.map((pool) => ({
        id: pool.id,
        name: pool.name,
        tournamentId: pool.tournament_id,
        adminUserId: pool.admin_user_id,
        joinCode: pool.join_code,
        invitedEmails: Array.isArray(pool.invited_emails) ? pool.invited_emails : [],
        memberUserIds:
          membershipsResult.data
            ?.filter((m) => m.pool_id === pool.id)
            .map((m) => m.user_id) ?? [],
        createdAt: pool.created_at,
        lockAt: pool.lock_at,
        tiers: Array.isArray(pool.tiers) ? (pool.tiers as Tier[]) : [],
      })) ?? [];

    const entries: PoolEntry[] =
      entriesResult.data?.map((e) => ({
        id: e.id,
        poolId: e.pool_id,
        userId: e.user_id,
        selections: Array.isArray(e.selections) ? (e.selections as TeamSelection[]) : [],
        submittedAt: e.submitted_at,
      })) ?? [];

    // Derive last sync time from the most-recently-synced tournament
    const rows = tournamentsResult.data as (RemoteTournamentRow[] | null);
    const scoresLastSyncedAt =
      rows
        ?.map((r) => r.scores_updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    setState({
      users,
      currentUserId: authData.user?.id ?? null,
      tournaments: (rows ?? []).map(mapTournamentRow),
      golfers: (golfersResult.data as RemoteGolferRow[] | null)?.map(mapGolferRow) ?? [],
      pools,
      entries,
      scoresLastSyncedAt,
    });

    setIsReady(true);
  }, []);

  // -------------------------------------------------------------------------
  // Mount: load data and listen for auth changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    void loadState();

    let subscription: { unsubscribe: () => void } | null = null;

    void getSupabaseBrowserClient().then((supabase) => {
      const { data } = supabase.auth.onAuthStateChange(() => {
        void loadState();
      });
      subscription = data.subscription;
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [loadState]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const value = useMemo<AppContextValue>(() => {
    const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? null;

    return {
      state,
      currentUser,
      isReady,

      // -- Auth ---------------------------------------------------------------
      async register(userName, email) {
        const supabase = await getSupabaseBrowserClient();
        const normalizedEmail = email.trim().toLowerCase();
        const redirectTo = `${window.location.origin}/auth/confirm?next=/`;

        const { error } = await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: {
            emailRedirectTo: redirectTo,
            shouldCreateUser: true,
            data: { user_name: userName.trim() },
          },
        });

        if (error) {
          return { ok: false, message: error.message };
        }

        return {
          ok: true,
          message: "Check your email for your sign-up link.",
          detail: `We sent a secure link to ${normalizedEmail}. Click it on this device to create your account.`,
        };
      },

      async login(email) {
        const supabase = await getSupabaseBrowserClient();
        const normalizedEmail = email.trim().toLowerCase();
        const redirectTo = `${window.location.origin}/auth/confirm?next=/`;

        const { error } = await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: {
            emailRedirectTo: redirectTo,
            shouldCreateUser: false,
          },
        });

        if (error) {
          return { ok: false, message: error.message };
        }

        return {
          ok: true,
          message: "Check your email for your sign-in link.",
          detail: `We sent a secure link to ${normalizedEmail}. Use it on this device to continue.`,
        };
      },

      async logout() {
        const supabase = await getSupabaseBrowserClient();
        await supabase.auth.signOut();
        setState(EMPTY_STATE);
        setIsReady(true);
      },

      // -- Pools --------------------------------------------------------------
      async createPool(input) {
        if (!currentUser) return null;

        const supabase = await getSupabaseBrowserClient();
        const {
          data: { user: authUser },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !authUser) {
          throw new Error(authError?.message ?? "No active session.");
        }

        // Ensure profile exists
        await supabase.from("profiles").upsert(
          {
            id: authUser.id,
            email: authUser.email ?? currentUser.email,
            user_name:
              typeof authUser.user_metadata?.user_name === "string" && authUser.user_metadata.user_name.trim()
                ? authUser.user_metadata.user_name.trim()
                : currentUser.userName,
          },
          { onConflict: "id" },
        );

        const { data: pool, error } = await supabase
          .from("pools")
          .insert({
            name: input.name.trim(),
            tournament_id: input.tournamentId,
            admin_user_id: authUser.id,
            join_code: createJoinCode(),
            invited_emails: [],
            lock_at: input.lockAt,
            tiers: input.tiers,
          })
          .select("id,join_code,created_at")
          .single();

        if (error || !pool) throw new Error(error?.message ?? "Pool insert failed.");

        await supabase.from("pool_members").insert({ pool_id: pool.id, user_id: authUser.id });

        await loadState();

        return {
          id: pool.id,
          name: input.name.trim(),
          tournamentId: input.tournamentId,
          adminUserId: authUser.id,
          joinCode: pool.join_code,
          invitedEmails: [],
          memberUserIds: [authUser.id],
          createdAt: pool.created_at,
          lockAt: input.lockAt,
          tiers: input.tiers,
        };
      },

      async joinPool(joinCode) {
        if (!currentUser) return null;

        const supabase = await getSupabaseBrowserClient();
        const { data: pool, error } = await supabase
          .rpc("join_pool_by_code", { input_code: joinCode.trim().toUpperCase() })
          .returns<JoinedPoolRow[]>()
          .single();

        if (error || !pool) return null;

        await loadState();

        return {
          id: pool.id,
          name: pool.name,
          tournamentId: pool.tournament_id,
          adminUserId: pool.admin_user_id,
          joinCode: pool.join_code,
          invitedEmails: Array.isArray(pool.invited_emails) ? pool.invited_emails : [],
          memberUserIds: [],
          createdAt: pool.created_at,
          lockAt: pool.lock_at,
          tiers: Array.isArray(pool.tiers) ? (pool.tiers as Tier[]) : [],
        };
      },

      async updatePoolTiers(poolId, tiers) {
        const supabase = await getSupabaseBrowserClient();
        await supabase.from("pools").update({ tiers }).eq("id", poolId);
        await loadState();
      },

      async inviteEmails(poolId, emails) {
        const pool = state.pools.find((p) => p.id === poolId);
        if (!pool) return;

        const supabase = await getSupabaseBrowserClient();
        const merged = Array.from(new Set([...pool.invitedEmails, ...emails.map((e) => e.toLowerCase())]));
        await supabase.from("pools").update({ invited_emails: merged }).eq("id", poolId);
        await loadState();
      },

      // -- Entries ------------------------------------------------------------
      async saveEntry(poolId, selections, submit) {
        if (!currentUser) return null;

        const pool = state.pools.find((p) => p.id === poolId);
        if (!pool || !pool.memberUserIds.includes(currentUser.id)) return null;
        if (isPoolLocked(pool)) return null;
        if (submit && !validateSelections(pool, selections).isValid) return null;

        const supabase = await getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("pool_entries")
          .upsert(
            {
              pool_id: poolId,
              user_id: currentUser.id,
              selections,
              submitted_at: submit
                ? new Date().toISOString()
                : existingSubmittedAt(state.entries, poolId, currentUser.id),
            },
            { onConflict: "pool_id,user_id" },
          )
          .select("id,pool_id,user_id,selections,submitted_at")
          .single();

        if (error || !data) return null;

        await loadState();

        return {
          id: data.id,
          poolId: data.pool_id,
          userId: data.user_id,
          selections: Array.isArray(data.selections) ? (data.selections as TeamSelection[]) : [],
          submittedAt: data.submitted_at,
        };
      },

      // -- Tournament data ----------------------------------------------------
      async importTournamentFeed(tournament, golfers) {
        const supabase = await getSupabaseBrowserClient();

        await supabase.from("tournaments").upsert(
          {
            id: tournament.id,
            name: tournament.name,
            course: tournament.course,
            start_date: tournament.startDate,
            status: tournament.status,
            purse: tournament.purse,
            source: tournament.source ?? null,
            source_url: tournament.sourceUrl ?? null,
            odds_source_url: tournament.oddsSourceUrl ?? null,
            import_meta: tournament.importMeta ?? null,
          },
          { onConflict: "id" },
        );

        await supabase.from("golfers").delete().eq("tournament_id", tournament.id);

        if (golfers.length > 0) {
          await supabase.from("golfers").upsert(
            golfers.map((g) => ({
              id: g.id,
              tournament_id: g.tournamentId,
              name: g.name,
              odds_american: g.oddsAmerican,
              implied_probability: g.impliedProbability,
              current_score_to_par: g.currentScoreToPar,
              position: g.position,
              made_cut: g.madeCut,
              rounds_complete: g.roundsComplete,
            })),
            { onConflict: "id" },
          );
        }

        await loadState();
      },

      // -- Live scores --------------------------------------------------------
      async refreshGolfers(tournamentId) {
        const supabase = await getSupabaseBrowserClient();
        const { data } = await supabase
          .from("golfers")
          .select(
            "id,tournament_id,name,odds_american,implied_probability,current_score_to_par,position,made_cut,rounds_complete",
          )
          .eq("tournament_id", tournamentId);

        if (!data) return;

        const updatedGolfers = data as RemoteGolferRow[];

        setState((prev) => ({
          ...prev,
          golfers: [
            ...prev.golfers.filter((g) => g.tournamentId !== tournamentId),
            ...updatedGolfers.map(mapGolferRow),
          ],
          scoresLastSyncedAt: new Date().toISOString(),
        }));
      },
    };
  }, [state, isReady, loadState]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}
