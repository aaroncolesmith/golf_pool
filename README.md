# Golf Pool Weekly

A web app for running a weekly PGA Tour pick-em pool. Commissioners create a pool tied to an upcoming tournament, invite players to draft a team of six golfers across odds-based tiers, and a live leaderboard tracks each team's score throughout the tournament.

## Features

- Magic-link authentication (Supabase OTP)
- Commissioner pool creation with tournament selection from DraftKings Sportsbook
- Six odds-based tiers with one golfer drafted per tier
- Team scoring: best four golfers who made the cut
- Live leaderboard with tiebreaker support and analytics tab
- Automated score syncing via GitHub Actions (Thu–Sun during tournament hours)
- Pool join via shareable invite code

## Stack

- Next.js 15 App Router
- React 19 / TypeScript
- Supabase (auth + database + realtime)
- Tailwind CSS

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase credentials
npm run dev -- --port 3005
```

Or via `make`:

```bash
make install
make run     # clears .next and starts on port 3005
make build
make lint
```

## Environment variables

See `.env.example` for the required variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `CRON_SECRET` | Shared secret for the score-sync cron route — must match the `CRON_SECRET` GitHub Actions secret |

## Database setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor, then run any numbered migrations in `supabase/migrations/` in order.
3. In Supabase Auth, add your local dev URL (`http://localhost:3005/auth/confirm`) and production URL to the allowed redirect URLs.

## Automated score syncing

A GitHub Actions workflow (`.github/workflows/sync-scores.yml`) hits `/api/scores/cron` every 10 minutes on Thursday–Sunday during tournament hours. To activate it, uncomment the `schedule:` cron lines in the workflow file and ensure the `APP_URL` and `CRON_SECRET` secrets are set in the GitHub repo settings.

## Docs

- [Engineering Roadmap](docs/ROADMAP.md)
