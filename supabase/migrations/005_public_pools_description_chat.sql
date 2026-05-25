-- Migration 005: Public pools, pool description, and pool chat

-- Add is_public and description to pools
alter table public.pools
  add column if not exists is_public boolean not null default false;

alter table public.pools
  add column if not exists description text;

-- Pool chat messages
create table if not exists public.pool_messages (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(message) <= 1000),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.pool_messages enable row level security;

-- Allow authenticated users to view public pools they haven't joined
drop policy if exists "public pools are viewable by authenticated users" on public.pools;
create policy "public pools are viewable by authenticated users"
  on public.pools for select
  to authenticated
  using (is_public = true);

-- Pool messages RLS
drop policy if exists "members can view pool messages" on public.pool_messages;
create policy "members can view pool messages"
  on public.pool_messages for select
  to authenticated
  using (public.is_pool_member(pool_messages.pool_id));

drop policy if exists "members can insert pool messages" on public.pool_messages;
create policy "members can insert pool messages"
  on public.pool_messages for insert
  to authenticated
  with check (auth.uid() = user_id and public.is_pool_member(pool_id));

-- Update join_pool_by_code to return new fields
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
  tiers jsonb,
  is_public boolean,
  description text
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
    target_pool.tiers,
    target_pool.is_public,
    target_pool.description;
end;
$$;

grant execute on function public.join_pool_by_code(text) to authenticated;

-- Enable realtime for pool_messages
alter publication supabase_realtime add table public.pool_messages;
