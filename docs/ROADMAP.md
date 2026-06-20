# Golf Pool — Engineering Roadmap

> Last updated: June 2026
> Current version: v2.1.3
> Stack: Next.js 15 · React 19 · TypeScript · Supabase · Tailwind CSS

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🔥 | High priority — next up |
| 📋 | Planned |
| 💡 | Stretch / future |

---

## Phase 0 — Foundation ✅

- ✅ Architecture locked: Supabase-only, no localStorage fallback, Next.js App Router
- ✅ CTO Roadmap document produced (`docs/CTO_Roadmap_Golf_Pool_Weekly.docx`)

---

## Phase 1 — Core Data Layer ✅

- ✅ Magic-link auth — `supabase.auth.signInWithOtp()`, no passwords
- ✅ localStorage removed — Supabase is the only persistence layer
- ✅ ESPN scoring integration — `lib/espn.ts` + `/api/scores/sync`; fuzzy name matching; position/CUT/WD/DQ derivation
- ✅ Server-side lock enforcement — RLS policies check `now() < lock_at`; `join_pool_by_code` and `submit_draft` RPCs enforce lock server-side
- ✅ Backend draft validation — `submit_draft` RPC validates auth, membership, lock, exactly 6 selections, no duplicate tiers
- ✅ Real-time leaderboard — Supabase Realtime `postgres_changes` on `golfers` table

---

## Phase 2 — Mobile-First UI ✅

- ✅ Tailwind CSS — `tailwind.config.ts`, `postcss.config.mjs`
- ✅ Card-based draft board — step-by-step tier picker with progress dots, auto-advance, locked state
- ✅ Mobile home screen — pool card list with rank + score + status pill, sticky nav, fixed bottom tab bar
- ✅ Pool page tabs — Leaderboard / My Picks / Members / Admin / Analytics
- ✅ Join flow — unauthenticated users get inline register/login, no redirect
- ✅ Error boundary — wraps root layout with "Try again" recovery

---

## Phase 3 — Automation ✅ / 📋

### 3.1 — Automated Score Syncing ✅
- ✅ `/api/scores/cron` route callable by cron scheduler
- ✅ GitHub Actions workflow (`.github/workflows/sync-scores.yml`) — configured for every 10 min Thu–Sun 7am–9pm ET
  - **Note:** cron schedule lines are currently commented out; uncomment + set `APP_URL` / `CRON_SECRET` GitHub secrets to activate
- ✅ Graceful no-op when ESPN has no data

### 3.2 — Pool Lock Reminder Emails 📋
- [ ] Query pools with `lock_at` within 24h / 1h
- [ ] Send via Supabase built-in email or Resend/Postmark
- [ ] Email template with pool name, lock time, direct link to picks tab

### 3.3 — Results / Outcome Notification 📋
- [ ] Detect `tournament.status` transition to `finished`
- [ ] Send final standings email to all pool members

---

## Phase 4 — Commissioner Tools 🔥 / 📋

### 4.1 — Pool Settings Page 🔥
No way to edit a pool after creation (name, lock time).

- [ ] `PATCH /api/pools/[id]` endpoint
- [ ] Settings form in Admin tab: rename pool, adjust lock time, copy join link
- [ ] Confirm dialog if members have already submitted

### 4.2 — Tournament Status Management 📋
Tournament status is set at import and never auto-updates.

- [ ] Auto-update `tournaments.status` from ESPN sync response
- [ ] Manual override for commissioner (weather delays, etc.)

### 4.3 — Leaderboard Tiebreaker Display ✅
- ✅ Tiebreaker rule defined (best individual golfer score)
- ✅ Tied entries sorted deterministically
- ✅ Tiebreaker indicator with tooltip (clickable `*` on mobile)

---

## Phase 5 — Player Experience 📋

### 5.1 — Public Leaderboard Link
- [ ] `/pools/[id]/leaderboard` public route (no auth required)
- [ ] Show team scores only — picks hidden until tournament finishes
- [ ] Open-graph meta tags for social sharing

### 5.2 — My Picks History
- [ ] "Past Pools" section on dashboard (pools where `tournament.status = finished`)
- [ ] Archive view showing final rank, score, picks

### 5.3 — Push Notifications 💡
- [ ] Service worker + Web Push API
- [ ] Notify on: leaderboard position changes, lock approaching, final standings

---

## Phase 6 — Scale & Infrastructure 📋

### 6.1 — Supabase RLS Audit
- [ ] Verify non-members cannot read pool entries before lock
- [ ] Verify commissioners cannot read other pools' data
- [ ] Cross-pool boundary penetration test via anon key

### 6.2 — Error Tracking
- [ ] Add Sentry (or equivalent) — capture unhandled errors + slow API routes
- [ ] Tag errors with `userId`, `poolId`, `tournamentId`

### 6.3 — Performance
- [ ] Audit Supabase query patterns; verify indexes on `pool_entries(pool_id, user_id)` and `golfers(tournament_id)`
- [ ] Consider ISR or edge caching for leaderboard route on tournament Sundays

---

## What to Build Next

1. **Pool settings / edit (4.1)** — commissioners hit this immediately after creating their first pool
2. **Activate automated score sync (3.1)** — uncomment cron lines + set GitHub secrets
3. **Lock reminder emails (3.2)** — eliminates "I forgot to submit" complaints
