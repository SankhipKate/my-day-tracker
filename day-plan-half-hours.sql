begin;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;
alter table public.tracker_day_slots drop constraint if exists tracker_day_slots_hour_check;
alter table public.tracker_day_slots alter column hour type numeric using hour::numeric;
alter table public.tracker_day_slots add column if not exists minutes smallint not null default 60;
alter table public.tracker_day_slots drop constraint if exists tracker_day_slots_time_check;
alter table public.tracker_day_slots add constraint tracker_day_slots_time_check
  check (minutes in (30,60) and hour * 2 = trunc(hour * 2)
    and hour >= 8 and hour + minutes / 60.0 <= 21);
alter table public.tracker_day_slots drop constraint if exists tracker_day_slots_no_overlap;
alter table public.tracker_day_slots add constraint tracker_day_slots_no_overlap
  exclude using gist (user_id with =, day with =, numrange(hour, hour + minutes / 60.0, '[)') with &&);
commit;
