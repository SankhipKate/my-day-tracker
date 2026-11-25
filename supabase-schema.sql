create table if not exists public.tracker_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('task', 'habit')),
  title text not null,
  category text,
  urgency text not null default 'medium' check (urgency in ('high', 'medium', 'low')),
  active boolean not null default true,
  completed_at date,
  completion_dates jsonb not null default '[]'::jsonb,
  planned_today_at date,
  created_at timestamptz not null default now()
);

alter table public.tracker_items
add column if not exists planned_today_at date;

alter table public.tracker_items enable row level security;

drop policy if exists "Users can read own tracker items" on public.tracker_items;
drop policy if exists "Users can insert own tracker items" on public.tracker_items;
drop policy if exists "Users can update own tracker items" on public.tracker_items;
drop policy if exists "Users can delete own tracker items" on public.tracker_items;

create policy "Users can read own tracker items"
on public.tracker_items for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own tracker items"
on public.tracker_items for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own tracker items"
on public.tracker_items for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own tracker items"
on public.tracker_items for delete
to authenticated
using (auth.uid() = user_id);

alter table public.tracker_items add column if not exists archived boolean not null default false;

alter table public.tracker_items add column if not exists habit_order integer;

create or replace function public.set_tracker_habit_order(ids uuid[])
returns void language sql security invoker set search_path = '' as $$
  update public.tracker_items as item
  set habit_order = ordered.position::integer
  from unnest(ids) with ordinality as ordered(id, position)
  where item.id = ordered.id and item.user_id = auth.uid() and item.type = 'habit';
$$;
