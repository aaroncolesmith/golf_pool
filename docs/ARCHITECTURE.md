# GolfPool — Architecture Overview

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database & Auth | Supabase (Postgres + Auth + Realtime) |
| Hosting | Vercel |
| Score source | ESPN unofficial public API |
| Scheduled jobs | GitHub Actions |

---

## Database Tables

### `tournaments`
One row per tournament. Key columns:
- `status` — `upcoming`, `in_progress`, or `finished`. Controls whether live score fetching runs.
- `espn_event_id` — stored after first successful sync so future syncs can skip name-matching.
- `scores_updated_at` — timestamp of last successful ESPN sync.

### `golfers`
One row per golfer per tournament (~150 rows per event). Key columns:
- `current_score_to_par` — cumulative score to par (e.g. `-5`, `+2`, `0`).
- `made_cut` — boolean. `false` means the player missed the cut or WD/DQ'd.
- `rounds_complete` — how many full rounds the player has finished (0–4).
- `r1_score` through `r4_score` — raw stroke totals per round (e.g. `67`, `72`). `null` = round not played.
- `position` — leaderboard position string (`"T3"`, `"CUT"`, `"WD"`, etc.).

### `pools`, `pool_members`, `pool_entries`
Pools belong to a tournament. Each entry has 6 golfer selections (one per tier). `pool_entries.submitted_at` marks a finalized team.

### `profiles`
User display names and emails, linked to Supabase Auth users.

---

## How Scores Get Into the Database

There are two paths scores take from ESPN into Supabase:

### Path 1 — Automated cron job (during live rounds)

```
GitHub Actions (every 10 min, Thu–Sun 7am–9pm ET)
  └─▶ GET /api/scores/cron   (protected by CRON_SECRET header)
        └─▶ lib/espn.ts: fetchEspnScores(tournamentName)
              └─▶ ESPN public API: site.api.espn.com/…/golf/pga/scoreboard
                    └─▶ parse scores, match golfers by name
                          └─▶ supabase.from("golfers").upsert(...)
```

The cron workflow is in `.github/workflows/sync-scores.yml`. It only fires when a tournament has `status = "in_progress"`. After each sync it checks whether all active players have 4 complete rounds; if so it sets `status = "finished"` automatically.

### Path 2 — Manual admin sync

An admin can trigger a sync from the Admin tab in the pool UI:

```
Admin tab → "Sync Scores" button
  └─▶ POST /api/scores/sync   (requires auth session)
        └─▶ lib/espn.ts: tries strategies in order:
              1. fetchEspnScoresByEventId(espn_event_id)   ← fastest, most reliable
              2. fetchEspnScores(tournamentName)            ← current live scoreboard
              3. fetchEspnScoresByDate(name, startDate+3)  ← and +2, +4, +1, +0 offsets
        └─▶ same upsert + status update as cron
```

The manual sync also lets admins supply a specific ESPN event ID or date to re-sync completed tournaments that have left the live scoreboard.

### How `lib/espn.ts` parses ESPN data

ESPN returns a `competitions[0].competitors` array. For each competitor:

1. **Cut detection** — check `status.type.name` for `STATUS_CUT`, `STATUS_WD`, `STATUS_DQ`, `STATUS_MDF`, or the `score` field for the string "CUT"/"WD"/"DQ". If any match → `madeCut = false`. **No inference from linescore count** — at the start of a new round most players have no score for that round yet, which would wrongly mark everyone as cut.

2. **Round scores** — `linescores[0..3]` map to R1–R4. ESPN fills unplayed slots with `0`, so only values `> 0` are stored; otherwise the column stays `null`.

3. **Rounds complete** — count of linescores with a positive value.

4. **Positions** — derived after all competitors are parsed by sorting active players by score and assigning `T3`-style labels. ESPN's own `order` field is not trusted for position because it can be stale.

5. **Name matching** — our golfer names (from the pre-tournament import) are normalized (lowercase, diacritics stripped) and matched against ESPN's `displayName`. Fallback: last-name-only match.

---

## How Scores Reach the Browser (Client-Side)

Score data flows from Supabase to the UI through two separate channels that are **merged client-side**:

### Channel 1 — Supabase DB (initial load + Realtime)

```
pool-page mounts
  └─▶ Supabase query: SELECT * FROM golfers WHERE tournament_id = ?
        └─▶ setDbGolferMap(raw)          ← all golfers for this tournament

Supabase Realtime subscription (postgres_changes on golfers table)
  └─▶ when any golfer row changes → setDbGolferMap(prev → updated copy)
```

This gives a ~1-second initial load and then live DB updates as the cron job writes new scores.

### Channel 2 — ESPN live poll (every 5 minutes)

```
LeaderboardTab mounts (when pool is locked)
  └─▶ GET /api/scores/tournament?tournamentId=...   (every 5 min)
        └─▶ For in_progress tournaments: fresh ESPN fetch at request time
        └─▶ For finished tournaments: read from DB (ESPN no longer has it)
        └─▶ returns: { golfers: [{name, score, today, thru, r1..r4, madeCut}] }
  └─▶ onEspnScores(scoreMap)   ← sets espnScores state in pool-page
```

The `today` (round score) and `thru` (holes completed) fields only come from this ESPN poll — they are not stored in the DB.

### Merge: `golferMap = useMemo(merge(dbGolferMap, espnScores))`

```typescript
// pool-page.tsx
const golferMap = useMemo(() => {
  // For each golfer in dbGolferMap:
  //   look up their name in espnScores
  //   if found → override currentScoreToPar, position, madeCut with ESPN values
  //   if not found → use DB values as-is
}, [dbGolferMap, espnScores]);
```

**Why the merge exists:** The cron job syncs every 10 minutes, but ESPN has scores updated hole-by-hole. The ESPN poll runs every 5 minutes in the browser and shows scores up to 5 minutes fresher than the DB. Merging gives the best of both: DB handles identity/roster data, ESPN handles live score overrides.

**Why it's a `useMemo` (not a `useEffect`):** Realtime DB updates used to call `setGolferMap` directly, which overwrote ESPN scores with the stale DB value (e.g. `0`) for any golfer whose row changed. Now the merge always runs fresh whenever *either* source changes, so Realtime updates can never erase ESPN overrides.

---

## Pool Leaderboard Scoring (`lib/scoring.ts`)

`buildLeaderboard(liveState, pool)` runs entirely client-side on every render.

### Team score
For each pool entry:
1. Find all 6 selected golfers in `liveState.golfers` (the merged map).
2. Filter to those with `madeCut = true`.
3. If fewer than 4 made the cut → team is **eliminated**.
4. Otherwise sort by `currentScoreToPar` ascending; take the 4 best as **counting golfers**.
5. `teamScore = sum of counting golfers' currentScoreToPar`.

### Tiebreaker order
When two teams have the same `teamScore`, compare deeper:

| Level | What's compared |
|---|---|
| 1 (primary) | top-4 scores (= team score) |
| 2 | top-3 scores |
| 3 | top-2 scores |
| 4 | top-1 score (single best golfer) |
| 5 | top-5 scores (counting + best bench) |
| 6 | top-6 scores (all 6 golfers) |

If teams are still identical through all 6 levels → `trulyTied = true` → displayed as "T3" with no tiebreaker indicator.

### Tiebreaker annotation (the `*` badge)
After sorting, adjacent pairs are scanned. For each adjacent pair with the same `teamScore`, the code finds which level first separated them and records it as `tiebreakerUsed`. The `*` shown next to a rank is clickable and shows "Tiebreaker: top N scores."

---

## Auth

Supabase Auth with magic-link email. Two-phase initialization in `lib/store.tsx`:

1. **Phase 1 (~1ms)** — `supabase.auth.getSession()` reads from `localStorage`. Sets `currentUserId` and flips `isReady = true` immediately. No network call. The page renders instantly without a loading screen.

2. **Phase 2 (network)** — `supabase.auth.getUser()` plus parallel fetches for all tables. Sets the full app state once network calls resolve. `isDataLoading` is `true` during this window; the pool page shows a skeleton instead of "Pool not found" until this completes.

---

## Key Gotchas

**Supabase PostgREST 1000-row cap** — the global store queries golfers with `.limit(5000)` but Supabase's project-level `max_rows` setting caps it at 1000. For tournaments with >1000 total golfers across all events this silently truncates. The pool page works around this by fetching golfers directly for the specific tournament (~150 rows, well under the cap).

**ESPN name matching** — our golfer names come from the pre-tournament import (DraftKings/DataGolf odds data). ESPN sometimes spells names differently (diacritics, hyphenation, Jr./III suffixes). The normalizer strips diacritics and punctuation; the fallback matches by last name only. Golfers that slip through both appear as "Unknown" on the leaderboard until the DB name is corrected.

**Course par inference** — ESPN does not return the course par directly. The `/api/scores/tournament` route derives it by sampling golfers: for each golfer with all current-period rounds complete, compute `(total strokes − score to par) / rounds`. The modal value (≥2 samples) becomes `coursePar`, defaulting to 72 if inference fails. This is used only for the "Today" column in the Tournament Leaderboard view.

**Finished tournaments** — once `status = "finished"`, all leaderboard data comes from the DB. ESPN removes finished events from its scoreboard within a day or two. The manual sync's date-based strategy (`start_date + 3/2/4/1/0` offsets) is the escape hatch for re-syncing a tournament that finished before the cron job caught it.
