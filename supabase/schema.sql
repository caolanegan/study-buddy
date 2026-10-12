-- Study Buddy cloud sync + leaderboard schema. Run in the Supabase SQL editor (safe to re-run).
create table if not exists public.study_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.study_state enable row level security;

drop policy if exists "own row" on public.study_state;
create policy "own row" on public.study_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- live updates between devices (safe to re-run)
do $$
begin
  alter publication supabase_realtime add table public.study_state;
exception when duplicate_object then null;
end $$;

-- ───────── Leaderboards (opt-in) ─────────
-- One row per player who turned on "Show me on leaderboards". Friends find each other by `code`,
-- which the database derives from the account id (so it can't be spoofed).
create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text generated always as (
    upper(substr(replace(user_id::text, '-', ''), 1, 4)) || '-' || upper(substr(replace(user_id::text, '-', ''), 5, 4))
  ) stored unique,
  name text not null check (char_length(name) between 1 and 24),
  week_key text not null check (char_length(week_key) <= 16),
  week_ms bigint not null default 0 check (week_ms between 0 and 604800000),
  total_ms bigint not null default 0 check (total_ms >= 0),
  streak int not null default 0 check (streak >= 0),
  is_public boolean not null default false,
  snapshot jsonb check (snapshot is null or pg_column_size(snapshot) < 8192),
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

-- Public rows (and your own) are readable; friends' rows are fetched by code through the function below.
drop policy if exists "signed-in users can read boards" on public.leaderboard;
drop policy if exists "read public or own" on public.leaderboard;
create policy "read public or own" on public.leaderboard
  for select to authenticated using (is_public or auth.uid() = user_id);

drop policy if exists "write own entry" on public.leaderboard;
create policy "write own entry" on public.leaderboard
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists leaderboard_week on public.leaderboard (week_key, week_ms desc) where is_public;

-- Look up rows by friend code (only the columns the app shows; never user_id).
create or replace function public.leaderboard_by_codes(codes text[])
returns table (code text, name text, week_key text, week_ms bigint, total_ms bigint, streak int, is_public boolean, snapshot jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.code, l.name, l.week_key, l.week_ms, l.total_ms, l.streak, l.is_public, l.snapshot, l.updated_at
  from public.leaderboard l
  where l.code = any (codes[1:200]);
$$;
revoke all on function public.leaderboard_by_codes(text[]) from public;
grant execute on function public.leaderboard_by_codes(text[]) to authenticated;
