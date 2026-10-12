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
-- One row per player who turned on "Share on leaderboard". Friends find each other by `code`.
create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique,
  name text not null,
  week_key text not null,
  week_ms bigint not null default 0,
  total_ms bigint not null default 0,
  streak int not null default 0,
  is_public boolean not null default false,
  snapshot jsonb,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

drop policy if exists "signed-in users can read boards" on public.leaderboard;
create policy "signed-in users can read boards" on public.leaderboard
  for select to authenticated using (true);

drop policy if exists "write own entry" on public.leaderboard;
create policy "write own entry" on public.leaderboard
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists leaderboard_week on public.leaderboard (week_key, week_ms desc) where is_public;
