# Golf Pool — Engineering Roadmap

> Last updated: April 2026
> Stack: Next.js 15 · React 19 · TypeScript · Supabase · Tailwind CSS

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🔄 | In progress |
| 🔥 | High priority — next up |
| 📋 | Planned |
| 💡 | Stretch / future |

---

## Phase 0 — Foundation & Planning ✅

- ✅ Deep codebase analysis
- ✅ CTO Roadmap document produced (`CTO_Roadmap_Golf_Pool_Weekly.docx`)
- ✅ Architecture decisions locked: Supabase-only, no localStorage fallback, App Router

---

## Phase 1 — Core Functional Fixes ✅

All six critical bugs patched. The app now has a real, secure data layer.

- ✅ **Magic link auth** — `register()` and `login()` call `supabase.auth.signInWithOtp()` directly; no password, no localStorage session
- ✅ **localStorage removal** — stripped ~500 lines of dual-mode code; Supabase is the only data layer
- ✅ **ESPN scoring integration** — `lib/espn.ts` + `POST /api/scores/sync`; fuzzy name matching (full name → last-name fallback); position/CUT/WD/DQ derivation
- ✅ **Server-side lock enforcement** — RLS policies check `now() < lock_at`; `join_pool_by_code` and `submit_draft` RPCs enforce lock server-side
- ✅ **Backend draft validation** — `submit_draft` RPC validates auth, membership, lock, exactly 6 selections, no duplicate tiers, each golfer in the correct tier
- ✅ **Real-time subscriptions** — Supabase Realtime `postgres_changes` on `golfers` table; pool page updates live without a refresh
- ✅ **SQL migration** — `supabase/migrations/001_phase1_enhancements.sql` covers all schema and policy changes

---

## Phase 2 — Mobile-First UI Overhaul ✅

Full visual redesign. The app now works well on phone.

- ✅ **Tailwind CSS added** — `tailwind.config.ts`, `postcss.config.mjs`, devDependencies updated (`npm install` required locally)
- ✅ **globals.css rewritten** — mobile-first breakpoints (640px / 768px); CSS variable design tokens preserved; new component classes: `.pool-card`, `.golfer-option`, `.draft-board`, `.pool-tab-bar`, `.score-badge`, `.member-row`, `.skeleton-line`, `.join-card`
- ✅ **Card-based draft board** (`components/draft-board.tsx`) — step-by-step tier picker; progress dots; auto-advance; locked state shows submitted picks with live scores
- ✅ **Mobile home screen** (`app-shell.tsx`) — pool card list with rank + score + status pill; sticky top nav; fixed bottom tab bar on mobile (safe-area aware); inline join strip; skeleton loading state
- ✅ **Pool page tabs** (`pool-page.tsx`) — My Picks / Leaderboard / Members / Admin tabs; scrollable tab bar; back nav; share button; live status pill
- ✅ **Join flow polish** (`join-pool-page.tsx`) — unauthenticated users get inline register/login; no redirect; one-tap join for authed users
- ✅ **Error boundary** (`components/error-boundary.tsx`) — wraps root layout; catches render errors with "Try again" button
- ✅ **Create wizard step 3 fix** — layout class bug fixed; review step now uses full width with clean vertical summary rows

---

## Phase 3 — Automation & Notifications 🔥

**Priority: High.** These are the gaps that will frustrate commissioners and players most in a live tournament week.

### 3.1 — Automated Score Syncing 🔥
Right now a commissioner must manually press "Sync from ESPN." During an active tournament scores change every few minutes.

- [ ] Create a `/api/scores/sync-cron` route (or edge function) callable by a cron scheduler
- [ ] Add a Supabase Edge Function or Vercel Cron Job that calls sync every 10 minutes during tournament hours (Thu–Sun, 7am–8pm ET)
- [ ] Show a "Live · updates every 10 min" indicator on the leaderboard tab when a tournament is in progress
- [ ] Graceful no-op when ESPN has no data (off-season, no active event)

### 3.2 — Pool Lock Reminder Emails 📋
Players forget to submit. A reminder email 24h and 1h before lock would cut "I forgot" dramatically.

- [ ] Supabase scheduled trigger or Edge Function that queries pools with `lock_at` in the next 24h and 1h
- [ ] Send via Supabase built-in email (or add Resend/Postmark for better deliverability)
- [ ] Email template: pool name, lock time, link directly to pool with `?tab=picks`
- [ ] Opt-out setting per user (future)

### 3.3 — Results / Outcome Notification 📋
When a tournament finishes, players want to know who won.

- [ ] Detect `tournament.status` transition to `finished` (either via ESPN sync or manual update)
- [ ] Send final standings email to all pool members
- [ ] Include top 3 teams with scores

---

## Phase 4 — Commissioner & Pool Management 🔥

### 4.1 — Pool Settings Page 🔥
Currently there's no way to edit a pool after creation (name, lock time).

- [ ] Add `PATCH /api/pools/[id]` endpoint
- [ ] Pool settings form in Admin tab: rename pool, adjust lock time (only if not yet locked), copy join link
- [ ] Confirm dialog before changing lock time if any members have already submitted

### 4.2 — Tournament Status Management 📋
Tournament status (`upcoming` / `in_progress` / `finished`) is set at import and never auto-updates.

- [ ] Add status field to the ESPN sync response
- [ ] Auto-update `tournaments.status` when ESPN indicates the event has started or ended
- [ ] Manual override button for commissioner (edge cases: weather delays, etc.)

### 4.3 — Leaderboard Tiebreaker Display 📋
Currently ties show the same score with no ordering guarantee.

- [ ] Define tiebreaker rule (e.g., best individual golfer score, then most golfers making cut)
- [ ] Sort tied entries deterministically
- [ ] Show "T2" style labels for ties

---

## Phase 5 — Player Experience 📋

### 5.1 — Public Leaderboard Link
Commissioners want to share results with people not in the pool (spouses, coworkers watching).

- [ ] Add `/pools/[id]/leaderboard` public route (no auth required)
- [ ] Show team scores only — picks hidden until after tournament finishes
- [ ] Open-graph meta tags for social sharing previews

### 5.2 — My Picks History
Players want to see past pool results.

- [ ] Add "Past Pools" section to dashboard (pools where tournament is `finished`)
- [ ] Archive view showing final rank, score, picks

### 5.3 — Push Notifications (Mobile Web) 💡
- [ ] Service worker + Web Push API
- [ ] Notify on: score changes that affect your leaderboard position, pool lock approaching, final standings

---

## Phase 6 — Scale & Infrastructure 📋

### 6.1 — Supabase RLS Audit
Before any public launch, all RLS policies need a security review.

- [ ] Verify non-members cannot read pool entries before lock
- [ ] Verify commissioners cannot read other pools' data
- [ ] Penetration test: attempt to read/write across pool boundaries via anon key

### 6.2 — Error Tracking
The error boundary logs to console. Production needs real observability.

- [ ] Add Sentry (or equivalent) to capture unhandled errors + slow API routes
- [ ] Tag errors with `userId`, `poolId`, `tournamentId` for fast triage

### 6.3 — Performance
- [ ] Audit Supabase query patterns — add indexes on `pool_entries(pool_id, user_id)` and `golfers(tournament_id)`
- [ ] Consider ISR or edge caching for the leaderboard route during high traffic (tournament Sundays)

---

## What to Build Next

Given the app is now functional and usable, the highest-leverage next items are:

1. **Automated score sync (3.1)** — without this, every live tournament requires manual intervention every few minutes. This is the single biggest operational pain point.
2. **Pool settings / edit (4.1)** — commissioners hit this immediately after creating their first pool and realizing they made a typo or set the wrong lock time.
3. **Lock reminder emails (3.2)** — reduces "I forgot to submit" complaints to zero.

After those three, Phase 5 (public leaderboard, picks history) opens the app up to casual observers and makes it shareable, which drives organic pool growth.
