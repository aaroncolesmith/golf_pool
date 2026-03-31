# Golf Pool Weekly

A lightweight MVP for running a weekly PGA pool:

- Magic-link style auth flow for registration and login
- Commissioner pool creation with tournament selection
- DraftKings-backed tournament import for upcoming events and outright odds
- Six odds-based tiers with one golfer drafted per tier
- Team scoring that counts the best four golfers who made the cut
- Leaderboard view and pool join/share flows

## Stack

- Next.js App Router
- React 19
- TypeScript
- Supabase for auth and pool persistence
- Browser-side cache for imported tournament feeds

## Run locally

1. `npm install`
2. Optional: add Supabase env vars in `.env.local`
2.5. Leave `NEXT_PUBLIC_ENABLE_SUPABASE=false` for local prototyping unless you explicitly want the Supabase flow on
3. `npm run dev -- --port 3005`
4. Open `http://localhost:3005`

Or use `make`:

- `make install`
- `make run`
- `make build`
- `make start`
- `make lint`

## Tournament ingestion

- The commissioner flow can import upcoming golf tournaments from [DraftKings Sportsbook](https://sportsbook.draftkings.com/sports/golf).
- Outright odds are currently parsed from the linked DraftKings Network "full field odds" article for each tournament.
- Imported tournaments and golfers are cached in the browser so they remain available after refresh.
- Tiers are auto-generated from implied probability and can still be adjusted by the commissioner before pool creation.
- Course details, purse, and lock time are still best-effort placeholders when DraftKings does not expose them cleanly on the public page.

## Prototype notes

- The "magic link" is exposed in the UI instead of sending a real email when Supabase is not configured.
- Pool, membership, and entry data persist in Supabase when env vars are present.
- A production version would likely still add:
  - A more stable odds/feed provider or a hardened DraftKings ingestion pipeline
  - A live PGA leaderboard feed for tournament scoring
  - Real outbound email delivery for magic links and invites

## Supabase setup

1. Create a Supabase project.
2. Run [supabase/schema.sql](/Users/aaronsmith/Code/golf_pool/supabase/schema.sql) in the SQL editor.
3. Copy [.env.example](/Users/aaronsmith/Code/golf_pool/.env.example) to `.env.local` and fill in your project URL and anon key.
4. Set `NEXT_PUBLIC_ENABLE_SUPABASE=true` when you want to use the live Supabase-backed flow.
5. In Supabase Auth, add `http://localhost:3000/auth/confirm`, `http://localhost:3005/auth/confirm`, and your Vercel production URL equivalent to the allowed redirect URLs.
6. Start the app. When the env vars are present and `NEXT_PUBLIC_ENABLE_SUPABASE=true`, auth, pools, memberships, and entries persist in Supabase instead of localStorage.

## Shared tournament data

- Tournament imports are now stored in Supabase so the imported field is shared across users and devices.
- If you already ran an older version of [supabase/schema.sql](/Users/aaronsmith/Code/golf_pool/supabase/schema.sql), run it again so the new `tournaments` and `golfers` tables plus their RLS policies are created.
