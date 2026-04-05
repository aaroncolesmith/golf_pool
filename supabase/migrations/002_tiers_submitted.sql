-- Add tiers_submitted_at to pools so admin can lock tiers and open drafting independently of the tournament start date.
-- NULL = tiers not yet submitted (drafting blocked)
-- Non-null = tiers locked, drafting open until lock_at

alter table public.pools add column if not exists tiers_submitted_at timestamptz;
