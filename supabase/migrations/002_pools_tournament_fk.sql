-- Migration 002: Add FK from pools.tournament_id → tournaments.id with cascade delete
--
-- This was missing from the original schema, which left pools orphaned when
-- a tournament was deleted. The cascade ensures pools (and their members /
-- entries) are cleaned up automatically.

-- 1. Delete any orphaned pools whose tournament no longer exists.
--    (Required before adding the FK constraint or it will fail.)
delete from public.pools
where tournament_id not in (select id from public.tournaments);

-- 2. Add the FK constraint with cascade delete.
alter table public.pools
  add constraint pools_tournament_id_fkey
  foreign key (tournament_id)
  references public.tournaments (id)
  on delete cascade;
