-- Study Buddy cloud sync schema. Run once in the Supabase SQL editor.
create table if not exists public.study_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.study_state enable row level security;

drop policy if exists "own row" on public.study_state;
create policy "own row" on public.study_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- live updates between devices
alter publication supabase_realtime add table public.study_state;
