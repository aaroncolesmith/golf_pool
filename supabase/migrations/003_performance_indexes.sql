-- Performance indexes to reduce Disk IO
-- All statements are idempotent (safe to re-run).

-- golfers.tournament_id: heavily hit by every cron sync and page load
create index if not exists idx_golfers_tournament_id
  on public.golfers (tournament_id);

-- pools.admin_user_id: evaluated on every RLS check for the admin policy
create index if not exists idx_pools_admin_user_id
  on public.pools (admin_user_id);

-- pool_entries.user_id: helps RLS evaluation and user-scoped queries
create index if not exists idx_pool_entries_user_id
  on public.pool_entries (user_id);

-- pool_members.user_id: helps is_pool_member() lookups by user
create index if not exists idx_pool_members_user_id
  on public.pool_members (user_id);
