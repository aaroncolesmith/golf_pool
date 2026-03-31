"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isPoolLocked, validateSelections } from "@/lib/pool";
import { initialState } from "@/lib/sample-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppState, AuthMode, AuthResult, Golfer, PendingMagicLink, Pool, PoolEntry, TeamSelection, Tier, Tournament, User } from "@/lib/types";
import { createId, createJoinCode } from "@/lib/utils";

const STORAGE_KEY = "golf-pool-state-v1";
const IMPORTED_FEED_STORAGE_KEY = "golf-pool-imported-feed-v1";

type CreatePoolInput = {
  name: string;
  tournamentId: string;
  lockAt: string;
  tiers: Tier[];
};

type AppContextValue = {
  state: AppState;
  currentUser: User | null;
  isUsingSupabase: boolean;
  register: (userName: string, email: string) => Promise<AuthResult>;
  login: (email: string) => Promise<AuthResult>;
  consumeMagicLink: (token: string) => Promise<User | null>;
  logout: () => Promise<void>;
  createPool: (input: CreatePoolInput) => Promise<Pool | null>;
  joinPool: (joinCode: string) => Promise<Pool | null>;
  updatePoolTiers: (poolId: string, tiers: Tier[]) => Promise<void>;
  inviteEmails: (poolId: string, emails: string[]) => Promise<void>;
  saveEntry: (poolId: string, selections: TeamSelection[], submit: boolean) => Promise<PoolEntry | null>;
  importTournamentFeed: (tournament: Tournament, golfers: Golfer[]) => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

type ImportedFeed = {
  tournaments: Tournament[];
  golfers: Golfer[];
};

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

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function mergeById<T extends { id: string }>(base: T[], extras: T[]) {
  const mapped = new Map(base.map((item) => [item.id, item]));

  for (const item of extras) {
    mapped.set(item.id, item);
  }

  return Array.from(mapped.values());
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = window.localStorage;

  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function"
  ) {
    return candidate;
  }

  return null;
}

async function getSafeSupabaseBrowserClient() {
  if (typeof window === "undefined" || !isSupabaseConfigured()) {
    return null;
  }

  return await getSupabaseBrowserClient();
}

function readImportedFeed(): ImportedFeed {
  const storage = getBrowserStorage();
  if (!storage) {
    return {
      tournaments: [],
      golfers: [],
    };
  }

  const stored = storage.getItem(IMPORTED_FEED_STORAGE_KEY);
  if (!stored) {
    return {
      tournaments: [],
      golfers: [],
    };
  }

  try {
    return JSON.parse(stored) as ImportedFeed;
  } catch {
    return {
      tournaments: [],
      golfers: [],
    };
  }
}

function persistImportedFeed(feed: ImportedFeed) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  storage.setItem(IMPORTED_FEED_STORAGE_KEY, JSON.stringify(feed));
}

function mergeImportedFeed(state: AppState) {
  const importedFeed = readImportedFeed();

  return {
    ...state,
    tournaments: mergeById(state.tournaments, importedFeed.tournaments),
    golfers: mergeById(state.golfers, importedFeed.golfers),
  };
}

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

function readInitialState(): AppState {
  const storage = getBrowserStorage();
  if (!storage) {
    return initialState;
  }

  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) {
    return mergeImportedFeed(initialState);
  }

  try {
    return mergeImportedFeed(JSON.parse(stored) as AppState);
  } catch {
    return mergeImportedFeed(initialState);
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const usingSupabase = isSupabaseConfigured();

  useEffect(() => {
    if (!usingSupabase) {
      setState(readInitialState());
      setHydrated(true);
      return;
    }

    async function loadRemoteState() {
      const supabase = await getSafeSupabaseBrowserClient();
      if (!supabase) {
        setHydrated(true);
        return;
      }

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
          .select("id,name,course,start_date,status,purse,source,source_url,odds_source_url,import_meta"),
        supabase
          .from("golfers")
          .select("id,tournament_id,name,odds_american,implied_probability,current_score_to_par,position,made_cut,rounds_complete"),
        supabase.from("pools").select("id,name,tournament_id,admin_user_id,join_code,invited_emails,created_at,lock_at,tiers"),
        supabase.from("pool_members").select("pool_id,user_id"),
        supabase.from("pool_entries").select("id,pool_id,user_id,selections,submitted_at"),
      ]);

      const users: User[] =
        profilesResult.data?.map((profile) => ({
          id: profile.id,
          email: profile.email,
          userName: profile.user_name,
          createdAt: profile.created_at,
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
            membershipsResult.data?.filter((membership) => membership.pool_id === pool.id).map((membership) => membership.user_id) ?? [],
          createdAt: pool.created_at,
          lockAt: pool.lock_at,
          tiers: Array.isArray(pool.tiers) ? (pool.tiers as Tier[]) : [],
        })) ?? [];

      const entries: PoolEntry[] =
        entriesResult.data?.map((entry) => ({
          id: entry.id,
          poolId: entry.pool_id,
          userId: entry.user_id,
          selections: Array.isArray(entry.selections) ? (entry.selections as TeamSelection[]) : [],
          submittedAt: entry.submitted_at,
        })) ?? [];

      setState({
        users,
        currentUserId: authData.user?.id ?? null,
        pendingMagicLinks: [],
        tournaments: mergeById(
          initialState.tournaments,
          (tournamentsResult.data as RemoteTournamentRow[] | null)?.map(mapTournamentRow) ?? [],
        ),
        golfers: mergeById(
          initialState.golfers,
          (golfersResult.data as RemoteGolferRow[] | null)?.map(mapGolferRow) ?? [],
        ),
        pools,
        entries,
      });
      setHydrated(true);
    }

    void loadRemoteState();

    let subscription: { unsubscribe: () => void } | null = null;

    void getSafeSupabaseBrowserClient().then((supabase) => {
      if (!supabase) {
        return;
      }

      const authSubscription = supabase.auth.onAuthStateChange(() => {
        void loadRemoteState();
      });

      subscription = authSubscription.data.subscription;
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [usingSupabase]);

  useEffect(() => {
    if (!hydrated || usingSupabase) {
      return;
    }

    const storage = getBrowserStorage();
    if (!storage) {
      return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const value = useMemo<AppContextValue>(() => {
    const currentUser = state.users.find((user) => user.id === state.currentUserId) ?? null;

    async function refreshRemoteState() {
      const supabase = await getSafeSupabaseBrowserClient();
      if (!supabase) {
        return;
      }

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
          .select("id,name,course,start_date,status,purse,source,source_url,odds_source_url,import_meta"),
        supabase
          .from("golfers")
          .select("id,tournament_id,name,odds_american,implied_probability,current_score_to_par,position,made_cut,rounds_complete"),
        supabase.from("pools").select("id,name,tournament_id,admin_user_id,join_code,invited_emails,created_at,lock_at,tiers"),
        supabase.from("pool_members").select("pool_id,user_id"),
        supabase.from("pool_entries").select("id,pool_id,user_id,selections,submitted_at"),
      ]);

      setState({
        users:
          profilesResult.data?.map((profile) => ({
            id: profile.id,
            email: profile.email,
            userName: profile.user_name,
            createdAt: profile.created_at,
          })) ?? [],
        currentUserId: authData.user?.id ?? null,
        pendingMagicLinks: [],
        tournaments: mergeById(
          initialState.tournaments,
          (tournamentsResult.data as RemoteTournamentRow[] | null)?.map(mapTournamentRow) ?? [],
        ),
        golfers: mergeById(
          initialState.golfers,
          (golfersResult.data as RemoteGolferRow[] | null)?.map(mapGolferRow) ?? [],
        ),
        pools:
          poolsResult.data?.map((pool) => ({
            id: pool.id,
            name: pool.name,
            tournamentId: pool.tournament_id,
            adminUserId: pool.admin_user_id,
            joinCode: pool.join_code,
            invitedEmails: Array.isArray(pool.invited_emails) ? pool.invited_emails : [],
            memberUserIds:
              membershipsResult.data?.filter((membership) => membership.pool_id === pool.id).map((membership) => membership.user_id) ?? [],
            createdAt: pool.created_at,
            lockAt: pool.lock_at,
            tiers: Array.isArray(pool.tiers) ? (pool.tiers as Tier[]) : [],
          })) ?? [],
        entries:
          entriesResult.data?.map((entry) => ({
            id: entry.id,
            poolId: entry.pool_id,
            userId: entry.user_id,
            selections: Array.isArray(entry.selections) ? (entry.selections as TeamSelection[]) : [],
            submittedAt: entry.submitted_at,
          })) ?? [],
      });
    }

    const createMagicLink = (user: User, mode: AuthMode) => {
      const link: PendingMagicLink = {
        token: createId("token"),
        email: user.email,
        userId: user.id,
        mode,
        createdAt: new Date().toISOString(),
      };

      setState((current) => ({
        ...current,
        pendingMagicLinks: [link, ...current.pendingMagicLinks],
      }));

      return link;
    };

    return {
      state,
      currentUser,
      isUsingSupabase: usingSupabase,
      async register(userName, email) {
        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          const normalizedEmail = email.trim().toLowerCase();
          const redirectTo = `${window.location.origin}/auth/confirm?next=/`;
          const { error } = await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              emailRedirectTo: redirectTo,
              shouldCreateUser: true,
              data: {
                user_name: userName.trim(),
              },
            },
          });

          if (error) {
            return {
              ok: false,
              message: error.message,
            };
          }

          return {
            ok: true,
            message: "Check your email for your sign-up link.",
            detail: `We sent a secure sign-in link to ${normalizedEmail}. It will create your account and bring you back into the pool.`,
          };
        }

        const normalizedEmail = email.trim().toLowerCase();
        const existingUser = state.users.find((user) => user.email === normalizedEmail);
        const user =
          existingUser ??
          {
            id: createId("user"),
            email: normalizedEmail,
            userName: userName.trim(),
            createdAt: new Date().toISOString(),
          };

        setState((current) => ({
          ...current,
          users: existingUser ? current.users : [user, ...current.users],
        }));

        const link = createMagicLink(user, "register");
        return {
          ok: true,
          message: `Complete registration for ${link.email}`,
          detail: "Magic-link preview mode is enabled for this environment.",
          previewHref: `/auth/callback?token=${link.token}`,
        };
      },
      async login(email) {
        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
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
            return {
              ok: false,
              message: error.message,
            };
          }

          return {
            ok: true,
            message: "Check your email for your login link.",
            detail: `We sent a secure sign-in link to ${normalizedEmail}. Use it on this device to continue.`,
          };
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = state.users.find((candidate) => candidate.email === normalizedEmail);

        if (!user) {
          return {
            ok: false,
            message: `No account exists for ${normalizedEmail}.`,
          };
        }

        const link = createMagicLink(user, "login");
        return {
          ok: true,
          message: `Sign in as ${link.email}`,
          detail: "Magic-link preview mode is enabled for this environment.",
          previewHref: `/auth/callback?token=${link.token}`,
        };
      },
      async consumeMagicLink(token) {
        if (await getSafeSupabaseBrowserClient()) {
          return null;
        }

        const link = state.pendingMagicLinks.find((candidate) => candidate.token === token);
        if (!link) {
          return null;
        }

        const user = state.users.find((candidate) => candidate.id === link.userId) ?? null;
        setState((current) => ({
          ...current,
          currentUserId: link.userId,
          pendingMagicLinks: current.pendingMagicLinks.filter((candidate) => candidate.token !== token),
        }));
        return user;
      },
      async logout() {
        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          await supabase.auth.signOut();
          await refreshRemoteState();
          return;
        }

        setState((current) => ({
          ...current,
          currentUserId: null,
        }));
      },
      async createPool(input) {
        if (!currentUser) {
          return null;
        }

        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          const {
            data: { user: authUser },
            error: authError,
          } = await supabase.auth.getUser();

          if (authError || !authUser) {
            throw new Error(authError?.message ?? "No active Supabase session found.");
          }

          const adminUserId = authUser.id;
          const adminEmail = authUser.email ?? currentUser.email;
          const adminUserName =
            typeof authUser.user_metadata?.user_name === "string" && authUser.user_metadata.user_name.trim()
              ? authUser.user_metadata.user_name.trim()
              : currentUser.userName;

          const { error: profileError } = await supabase.from("profiles").upsert(
            {
              id: adminUserId,
              email: adminEmail,
              user_name: adminUserName,
            },
            { onConflict: "id" },
          );

          if (profileError) {
            throw new Error(profileError.message);
          }

          const nextPool = {
            name: input.name.trim(),
            tournament_id: input.tournamentId,
            admin_user_id: adminUserId,
            join_code: createJoinCode(),
            invited_emails: [],
            lock_at: input.lockAt,
            tiers: input.tiers,
          };

          const { data: insertedPool, error } = await supabase
            .from("pools")
            .insert(nextPool)
            .select("id,join_code,created_at")
            .single();

          if (error || !insertedPool) {
            throw new Error(error?.message ?? "Pool insert failed.");
          }

          const { error: membershipError } = await supabase.from("pool_members").insert({
            pool_id: insertedPool.id,
            user_id: adminUserId,
          });

          if (membershipError) {
            throw new Error(membershipError.message);
          }

          await refreshRemoteState();

          return {
            id: insertedPool.id,
            name: nextPool.name,
            tournamentId: nextPool.tournament_id,
            adminUserId,
            joinCode: insertedPool.join_code,
            invitedEmails: [],
            memberUserIds: [adminUserId],
            createdAt: insertedPool.created_at,
            lockAt: nextPool.lock_at,
            tiers: nextPool.tiers,
          };
        }

        const pool: Pool = {
          id: createId("pool"),
          name: input.name.trim(),
          tournamentId: input.tournamentId,
          adminUserId: currentUser.id,
          joinCode: createJoinCode(),
          invitedEmails: [],
          memberUserIds: [currentUser.id],
          createdAt: new Date().toISOString(),
          lockAt: input.lockAt,
          tiers: input.tiers,
        };

        setState((current) => ({
          ...current,
          pools: [pool, ...current.pools],
        }));

        return pool;
      },
      async joinPool(joinCode) {
        if (!currentUser) {
          return null;
        }

        const normalizedCode = joinCode.trim().toUpperCase();

        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          const { data: pool } = await supabase
            .from("pools")
            .select("id,name,tournament_id,admin_user_id,join_code,invited_emails,created_at,lock_at,tiers")
            .eq("join_code", normalizedCode)
            .single();

          if (!pool) {
            return null;
          }

          await supabase.from("pool_members").upsert(
            {
              pool_id: pool.id,
              user_id: currentUser.id,
            },
            { onConflict: "pool_id,user_id", ignoreDuplicates: true },
          );

          await refreshRemoteState();

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
        }

        const pool = state.pools.find((candidate) => candidate.joinCode === normalizedCode);

        if (!pool) {
          return null;
        }

        setState((current) => ({
          ...current,
          pools: current.pools.map((candidate) =>
            candidate.id === pool.id
              ? {
                  ...candidate,
                  memberUserIds: candidate.memberUserIds.includes(currentUser.id)
                    ? candidate.memberUserIds
                    : [...candidate.memberUserIds, currentUser.id],
                }
              : candidate,
          ),
        }));

        return pool;
      },
      async updatePoolTiers(poolId, tiers) {
        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          await supabase.from("pools").update({ tiers }).eq("id", poolId);
          await refreshRemoteState();
          return;
        }

        setState((current) => ({
          ...current,
          pools: current.pools.map((pool) => (pool.id === poolId ? { ...pool, tiers } : pool)),
        }));
      },
      async inviteEmails(poolId, emails) {
        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          const pool = state.pools.find((candidate) => candidate.id === poolId);
          if (!pool) {
            return;
          }

          const invitedEmails = Array.from(new Set([...pool.invitedEmails, ...emails.map((email) => email.toLowerCase())]));
          await supabase.from("pools").update({ invited_emails: invitedEmails }).eq("id", poolId);
          await refreshRemoteState();
          return;
        }

        setState((current) => ({
          ...current,
          pools: current.pools.map((pool) =>
            pool.id === poolId
              ? {
                  ...pool,
                  invitedEmails: Array.from(new Set([...pool.invitedEmails, ...emails.map((email) => email.toLowerCase())])),
                }
              : pool,
          ),
        }));
      },
      async saveEntry(poolId, selections, submit) {
        if (!currentUser) {
          return null;
        }

        const pool = state.pools.find((candidate) => candidate.id === poolId);
        if (!pool) {
          return null;
        }

        if (!pool.memberUserIds.includes(currentUser.id)) {
          return null;
        }

        if (isPoolLocked(pool)) {
          return null;
        }

        if (submit && !validateSelections(pool, selections).isValid) {
          return null;
        }

        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          const payload = {
            pool_id: poolId,
            user_id: currentUser.id,
            selections,
            submitted_at: submit ? new Date().toISOString() : existingSubmittedAt(state.entries, poolId, currentUser.id),
          };

          const { data, error } = await supabase
            .from("pool_entries")
            .upsert(payload, { onConflict: "pool_id,user_id" })
            .select("id,pool_id,user_id,selections,submitted_at")
            .single();

          if (error || !data) {
            return null;
          }

          await refreshRemoteState();

          return {
            id: data.id,
            poolId: data.pool_id,
            userId: data.user_id,
            selections: Array.isArray(data.selections) ? (data.selections as TeamSelection[]) : [],
            submittedAt: data.submitted_at,
          };
        }

        const existing = state.entries.find((entry) => entry.poolId === poolId && entry.userId === currentUser.id);
        const nextEntry: PoolEntry = existing
          ? {
              ...existing,
              selections,
              submittedAt: submit ? new Date().toISOString() : existing.submittedAt,
            }
          : {
              id: createId("entry"),
              poolId,
              userId: currentUser.id,
              selections,
              submittedAt: submit ? new Date().toISOString() : null,
            };

        setState((current) => ({
          ...current,
          entries: existing
            ? current.entries.map((entry) => (entry.id === existing.id ? nextEntry : entry))
            : [nextEntry, ...current.entries],
        }));

        return nextEntry;
      },
      async importTournamentFeed(tournament, golfers) {
        const supabase = await getSafeSupabaseBrowserClient();
        if (supabase) {
          const tournamentPayload = {
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
          };

          const golferPayload = golfers.map((golfer) => ({
            id: golfer.id,
            tournament_id: golfer.tournamentId,
            name: golfer.name,
            odds_american: golfer.oddsAmerican,
            implied_probability: golfer.impliedProbability,
            current_score_to_par: golfer.currentScoreToPar,
            position: golfer.position,
            made_cut: golfer.madeCut,
            rounds_complete: golfer.roundsComplete,
          }));

          const { error: tournamentError } = await supabase
            .from("tournaments")
            .upsert(tournamentPayload, { onConflict: "id" });

          if (tournamentError) {
            throw tournamentError;
          }

          await supabase.from("golfers").delete().eq("tournament_id", tournament.id);

          if (golferPayload.length > 0) {
            const { error: golferError } = await supabase
              .from("golfers")
              .upsert(golferPayload, { onConflict: "id" });

            if (golferError) {
              throw golferError;
            }
          }

          await refreshRemoteState();
          return;
        }

        const importedFeed = readImportedFeed();
        const nextFeed = {
          tournaments: mergeById(importedFeed.tournaments, [tournament]),
          golfers: mergeById(
            importedFeed.golfers.filter((golfer) => golfer.tournamentId !== tournament.id),
            golfers,
          ),
        };

        persistImportedFeed(nextFeed);

        setState((current) => ({
          ...current,
          tournaments: mergeById(current.tournaments, [tournament]),
          golfers: mergeById(
            current.golfers.filter((golfer) => golfer.tournamentId !== tournament.id),
            golfers,
          ),
        }));
      },
    };
  }, [state, usingSupabase]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function existingSubmittedAt(entries: PoolEntry[], poolId: string, userId: string) {
  return entries.find((entry) => entry.poolId === poolId && entry.userId === userId)?.submittedAt ?? null;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}
