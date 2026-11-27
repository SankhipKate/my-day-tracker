begin;
create table if not exists public.tracker_day_slots (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  hour smallint not null check (hour between 8 and 19),
  habit_id uuid references public.tracker_items(id) on delete cascade,
  note text,
  primary key (user_id, day, hour),
  unique (user_id, day, habit_id),
  check ((habit_id is not null and note is null) or
         (habit_id is null and note is not null and length(trim(note)) between 1 and 240))
);
alter table public.tracker_day_slots enable row level security;
grant select, insert, update, delete on public.tracker_day_slots to authenticated;
drop policy if exists own_slots on public.tracker_day_slots;
create policy own_slots on public.tracker_day_slots for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function public.validate_tracker_slot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.habit_id is not null then
    perform 1 from public.tracker_items where id = new.habit_id and user_id = new.user_id
      and not archived and planned_today_at = new.day
      and (active or (type = 'task' and completed_at = new.day)) for share;
    if not found then raise exception 'Обнови список дел на сегодня'; end if;
  end if;
  return new;
end $$;
drop trigger if exists validate_tracker_slot on public.tracker_day_slots;
create trigger validate_tracker_slot before insert or update on public.tracker_day_slots
for each row execute function public.validate_tracker_slot();
create or replace function public.clear_tracker_slot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.tracker_day_slots where habit_id = new.id and day = old.planned_today_at;
  return new;
end $$;
drop trigger if exists clear_tracker_slot on public.tracker_items;
create trigger clear_tracker_slot after update on public.tracker_items for each row
when (old.planned_today_at is distinct from new.planned_today_at or new.archived
  or (not new.active and (new.type <> 'task' or new.completed_at is distinct from new.planned_today_at)))
execute function public.clear_tracker_slot();
commit;
