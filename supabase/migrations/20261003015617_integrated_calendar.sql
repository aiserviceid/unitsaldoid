create table if not exists public.calendar_events (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 1 and 120),
 event_date date not null,
 note text not null default '' check(char_length(note)<=500),
 completed boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists calendar_events_owner_date on public.calendar_events(owner_id,event_date);
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public,anon;
grant select,insert,update,delete on public.calendar_events to authenticated;
grant all on public.calendar_events to service_role;
drop policy if exists calendar_owner on public.calendar_events;
create policy calendar_owner on public.calendar_events for all to authenticated
 using(owner_id=(select auth.uid()) and public.has_unitsaldo_access())
 with check(owner_id=(select auth.uid()) and public.has_unitsaldo_access());
