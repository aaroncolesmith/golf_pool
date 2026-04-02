-- =============================================================================
-- Phase 1 Enhancements
-- Run this against your Supabase project via the SQL Editor.
-- All statements are idempotent (safe to re-run).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add scores_updated_at to tournaments
--    Tracks when live scores were last synced so the UI can show freshness.
-- -----------------------------------------------------------------------------
alter table public.tournaments
  add column if not exists scores_updated_at timestamptz;


-- -----------------------------------------------------------------------------
-- 2. Server-side draft lock enforcement
--    Replace the permissive INSERT/UPDATE policies on pool_entries with
--    lock-aware versions that reject writes after the pool's lock_at time.
--    This is the critical integrity guard — client-side checks alone are
--    insufficient.
-- -----------------------------------------------------------------------------

drop policy if exists "users can manage their own entries" on public.pool_entries;
drop policy if exists "users can update their own entries" on public.pool_entries;

create policy "users can insert entries before lock"
  on public.pool_entries for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and now() < (
      select lock_at from public.pools where id = pool_id
    )
  );

create policy "users can update entries before lock"
  on public.pool_entries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and now() < (
      select lock_at from public.pools where id = pool_id
    )
  );

-- Allow members to delete their own draft before lock
drop policy if exists "users can delete their own entries" on public.pool_entries;
create policy "users can delete entries before lock"
  on public.pool_entries for delete
  to authenticated
  using (
    auth.uid() = user_id
    and now() < (
      select lock_at from public.pools where id = pool_id
    )
  );


-- -----------------------------------------------------------------------------
-- 3. Prevent joining a locked pool
--    Update join_pool_by_code to reject joins after tournament start.
-- -----------------------------------------------------------------------------
create or replace function public.join_pool_by_code(input_code text)
returns table (
  id uuid,
  name text,
  tournament_id text,
  admin_user_id uuid,
  join_code text,
  invited_emails text[],
  created_at timestamptz,
  lock_at timestamptz,
  tiers jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(trim(input_code));
  target_pool public.pools%rowtype;
begin
  if auth.uid() is null then
    return;
  end if;

  select *
  into target_pool
  from public.pools
  where pools.join_code = normalized_code
  limit 1;

  if not found then
    return;
  end if;

  -- Reject join if tournament has already locked
  if now() >= target_pool.lock_at then
    return;
  end if;

  insert into public.pool_members (pool_id, user_id)
  values (target_pool.id, auth.uid())
  on conflict (pool_id, user_id) do nothing;

  return query
  select
    target_pool.id,
    target_pool.name,
    target_pool.tournament_id,
    target_pool.admin_user_id,
    target_pool.join_code,
    target_pool.invited_emails,
    target_pool.created_at,
    target_pool.lock_at,
    target_pool.tiers;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. submit_draft RPC
--    Server-side validated draft submission.
--    Checks: authenticated, is pool member, pool not locked,
--            exactly 6 selections, one per tier, all golferIds valid.
-- -----------------------------------------------------------------------------
create or replace function public.submit_draft(
  p_pool_id  uuid,
  p_selections jsonb   -- [{tierId: string, golferId: string}, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool          public.pools%rowtype;
  v_selection     jsonb;
  v_tier_id       text;
  v_golfer_id     text;
  v_tier_count    int;
  i               int;
begin
  -- Must be authenticated
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  -- Load pool
  select * into v_pool from public.pools where id = p_pool_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pool not found');
  end if;

  -- Pool must not be locked
  if now() >= v_pool.lock_at then
    return jsonb_build_object('ok', false, 'error', 'Pool is locked — submissions are closed');
  end if;

  -- User must be a member
  if not public.is_pool_member(p_pool_id) then
    return jsonb_build_object('ok', false, 'error', 'You are not a member of this pool');
  end if;

  -- Must be exactly 6 selections
  if jsonb_array_length(p_selections) != 6 then
    return jsonb_build_object('ok', false, 'error', 'Must select exactly 6 golfers (one per tier)');
  end if;

  -- Count distinct tiers in pool
  select jsonb_array_length(v_pool.tiers) into v_tier_count;
  if v_tier_count != 6 then
    return jsonb_build_object('ok', false, 'error', 'Pool does not have 6 tiers configured');
  end if;

  -- Validate no duplicate tier IDs in selections
  if (
    select count(distinct value->>'tierId')
    from jsonb_array_elements(p_selections) value
  ) != 6 then
    return jsonb_build_object('ok', false, 'error', 'Each tier must be selected exactly once');
  end if;

  -- Validate each selection: tierId exists and golferId is in that tier
  for i in 0..jsonb_array_length(p_selections) - 1 loop
    v_selection := p_selections->i;
    v_tier_id   := v_selection->>'tierId';
    v_golfer_id := v_selection->>'golferId';

    if v_tier_id is null or v_golfer_id is null then
      return jsonb_build_object('ok', false, 'error', 'Each selection must have tierId and golferId');
    end if;

    -- Check golfer belongs to the specified tier in this pool's tier config
    if not exists (
      select 1
      from jsonb_array_elements(v_pool.tiers) as tier
      where (tier->>'id') = v_tier_id
        and (tier->'golferIds') @> jsonb_build_array(v_golfer_id)
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', format('Golfer %s is not in tier %s', v_golfer_id, v_tier_id)
      );
    end if;
  end loop;

  -- All checks passed — upsert the entry
  insert into public.pool_entries (pool_id, user_id, selections, submitted_at)
  values (p_pool_id, auth.uid(), p_selections, now())
  on conflict (pool_id, user_id)
  do update set
    selections   = excluded.selections,
    submitted_at = excluded.submitted_at,
    updated_at   = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_draft(uuid, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Ensure the updated_at trigger exists on pool_entries
--    (defensive re-create in case schema.sql hasn't been applied)
-- -----------------------------------------------------------------------------
drop trigger if exists pool_entries_set_updated_at on public.pool_entries;
create trigger pool_entries_set_updated_at
  before update on public.pool_entries
  for each row execute procedure public.set_updated_at();
