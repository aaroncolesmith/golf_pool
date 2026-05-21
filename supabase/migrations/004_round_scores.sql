-- Add per-round stroke totals to golfers so finished-tournament data is
-- fully self-contained in the DB and does not require a live ESPN fetch.
alter table public.golfers
  add column if not exists r1_score integer,
  add column if not exists r2_score integer,
  add column if not exists r3_score integer,
  add column if not exists r4_score integer;

-- Store the ESPN event ID after first successful sync so we can look up
-- tournament-specific data even after it leaves the current scoreboard.
alter table public.tournaments
  add column if not exists espn_event_id text;
