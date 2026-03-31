create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  user_name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tournaments (
  id text primary key,
  name text not null,
  course text not null,
  start_date timestamptz not null,
  status text not null check (status in ('upcoming', 'in_progress', 'finished')),
  purse text not null,
  source text,
  source_url text,
  odds_source_url text,
  import_meta jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.golfers (
  id text primary key,
  tournament_id text not null references public.tournaments (id) on delete cascade,
  name text not null,
  odds_american integer not null,
  implied_probability double precision not null,
  current_score_to_par integer not null default 0,
  position text not null default 'TBD',
  made_cut boolean not null default true,
  rounds_complete integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tournament_id text not null,
  admin_user_id uuid not null references public.profiles (id) on delete cascade,
  join_code text not null unique,
  invited_emails text[] not null default '{}',
  lock_at timestamptz not null,
  tiers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pool_members (
  pool_id uuid not null references public.pools (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default timezone('utc', now()),
  primary key (pool_id, user_id)
);

create table if not exists public.pool_entries (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  selections jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (pool_id, user_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, user_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'user_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    user_name = coalesce(nullif(excluded.user_name, ''), public.profiles.user_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.is_pool_member(target_pool_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.pool_members
    where pool_members.pool_id = target_pool_id
      and pool_members.user_id = auth.uid()
  );
$$;

drop trigger if exists pool_entries_set_updated_at on public.pool_entries;
create trigger pool_entries_set_updated_at
  before update on public.pool_entries
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.golfers enable row level security;
alter table public.pools enable row level security;
alter table public.pool_members enable row level security;
alter table public.pool_entries enable row level security;

drop policy if exists "profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "users can insert their own profile" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;

drop policy if exists "tournaments are viewable by authenticated users" on public.tournaments;
drop policy if exists "authenticated users can insert tournaments" on public.tournaments;
drop policy if exists "authenticated users can update tournaments" on public.tournaments;

drop policy if exists "golfers are viewable by authenticated users" on public.golfers;
drop policy if exists "authenticated users can insert golfers" on public.golfers;
drop policy if exists "authenticated users can update golfers" on public.golfers;

drop policy if exists "authenticated users can create pools" on public.pools;
drop policy if exists "admins can view their pools" on public.pools;
drop policy if exists "members can view joined pools" on public.pools;
drop policy if exists "admins can update their pools" on public.pools;

drop policy if exists "authenticated users can join pools" on public.pool_members;
drop policy if exists "members can view pool memberships" on public.pool_members;

drop policy if exists "members can view pool entries" on public.pool_entries;
drop policy if exists "users can manage their own entries" on public.pool_entries;
drop policy if exists "users can update their own entries" on public.pool_entries;

create policy "profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "tournaments are viewable by authenticated users"
  on public.tournaments for select
  to authenticated
  using (true);

create policy "authenticated users can insert tournaments"
  on public.tournaments for insert
  to authenticated
  with check (true);

create policy "authenticated users can update tournaments"
  on public.tournaments for update
  to authenticated
  using (true)
  with check (true);

create policy "golfers are viewable by authenticated users"
  on public.golfers for select
  to authenticated
  using (true);

create policy "authenticated users can insert golfers"
  on public.golfers for insert
  to authenticated
  with check (true);

create policy "authenticated users can update golfers"
  on public.golfers for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can create pools"
  on public.pools for insert
  to authenticated
  with check (auth.uid() = admin_user_id);

create policy "admins can view their pools"
  on public.pools for select
  to authenticated
  using (auth.uid() = admin_user_id);

create policy "members can view joined pools"
  on public.pools for select
  to authenticated
  using (
    public.is_pool_member(pools.id)
  );

create policy "admins can update their pools"
  on public.pools for update
  to authenticated
  using (auth.uid() = admin_user_id)
  with check (auth.uid() = admin_user_id);

create policy "authenticated users can join pools"
  on public.pool_members for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "members can view pool memberships"
  on public.pool_members for select
  to authenticated
  using (
    public.is_pool_member(pool_members.pool_id)
  );

create policy "members can view pool entries"
  on public.pool_entries for select
  to authenticated
  using (
    public.is_pool_member(pool_entries.pool_id)
  );

create policy "users can manage their own entries"
  on public.pool_entries for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users can update their own entries"
  on public.pool_entries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
