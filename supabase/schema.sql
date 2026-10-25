-- Run once in a new Supabase project's SQL Editor as the project owner.
begin;

create schema if not exists planner_private;
revoke all on schema planner_private from public, anon;
grant usage on schema planner_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '학생' check (char_length(display_name) between 1 and 40),
  role text not null default 'student' check (role in ('student', 'teacher')),
  grade integer check (grade between 1 and 3),
  classroom integer check (classroom between 1 and 30),
  created_at timestamptz not null default now()
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('class', 'club')),
  grade integer check (grade between 1 and 3),
  classroom integer check (classroom between 1 and 30),
  club_name text,
  created_at timestamptz not null default now(),
  check ((kind = 'class' and grade is not null and classroom is not null)
    or (kind = 'club' and char_length(trim(club_name)) > 0 and club_name is not null))
);
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, student_id)
);
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete restrict,
  type text not null check (type in ('notice', 'assignment')),
  subject text not null check (char_length(trim(subject)) between 1 and 25),
  title text not null check (char_length(trim(title)) between 1 and 80),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  due_date date,
  created_at timestamptz not null default now()
);
create table public.notice_progress (
  student_id uuid not null references public.profiles(id) on delete cascade,
  notice_id uuid not null references public.notices(id) on delete cascade,
  completed boolean not null default false,
  saved_to_planner boolean not null default false,
  primary key (student_id, notice_id)
);
create table public.planner_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 70),
  event_date date not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.groups(owner_id);
create index on public.group_members(student_id);
create index on public.notices(group_id, due_date);
create index on public.notices(author_id);
create index on public.notice_progress(notice_id);
create index on public.planner_events(student_id, event_date);

create function planner_private.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;
create function planner_private.owns_group(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select planner_private.is_teacher() and exists
    (select 1 from public.groups where id = target and owner_id = auth.uid());
$$;
create function planner_private.can_read_notice(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.notices n where n.id = target and (
      n.author_id = auth.uid() or n.group_id is null or exists (
        select 1 from public.group_members m where m.group_id = n.group_id and m.student_id = auth.uid()
      )
    )
  );
$$;
revoke all on all functions in schema planner_private from public, anon;
grant execute on all functions in schema planner_private to authenticated;

-- New accounts always start as students. Role changes require the project owner.
create function planner_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id);
  return new;
end;
$$;
revoke all on function planner_private.handle_new_user() from public, anon, authenticated;
create trigger planner_user_created after insert on auth.users
for each row execute function planner_private.handle_new_user();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.notices enable row level security;
alter table public.notice_progress enable row level security;
alter table public.planner_events enable row level security;

revoke all on public.profiles, public.groups, public.group_members, public.notices,
  public.notice_progress, public.planner_events from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select, insert, delete on public.groups, public.notices to authenticated;
grant update(name, kind, grade, classroom, club_name) on public.groups to authenticated;
grant update(group_id, type, subject, title, body, due_date) on public.notices to authenticated;
grant select, insert, delete on public.group_members to authenticated;
grant select, insert, update, delete on public.notice_progress, public.planner_events to authenticated;

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select planner_private.is_teacher()));
create policy profiles_edit_name on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy groups_read on public.groups for select to authenticated using (
  owner_id = (select auth.uid()) or exists (
    select 1 from public.group_members m where m.group_id = groups.id and m.student_id = (select auth.uid())
  )
);
create policy groups_create on public.groups for insert to authenticated
with check (owner_id = (select auth.uid()) and (select planner_private.is_teacher()));
create policy groups_edit on public.groups for update to authenticated
using (planner_private.owns_group(id)) with check (planner_private.owns_group(id));
create policy groups_delete on public.groups for delete to authenticated using (planner_private.owns_group(id));

create policy members_read on public.group_members for select to authenticated
using (student_id = (select auth.uid()) or planner_private.owns_group(group_id));
create policy members_add on public.group_members for insert to authenticated
with check (planner_private.owns_group(group_id));
create policy members_remove on public.group_members for delete to authenticated
using (planner_private.owns_group(group_id));

create policy notices_read on public.notices for select to authenticated
using (planner_private.can_read_notice(id));
create policy notices_create on public.notices for insert to authenticated with check (
  author_id = (select auth.uid()) and (select planner_private.is_teacher())
  and (group_id is null or planner_private.owns_group(group_id))
);
create policy notices_edit on public.notices for update to authenticated
using (author_id = (select auth.uid()) and (select planner_private.is_teacher()))
with check (author_id = (select auth.uid()) and (group_id is null or planner_private.owns_group(group_id)));
create policy notices_delete on public.notices for delete to authenticated
using (author_id = (select auth.uid()) and (select planner_private.is_teacher()));

create policy progress_read on public.notice_progress for select to authenticated
using (student_id = (select auth.uid()) and planner_private.can_read_notice(notice_id));
create policy progress_create on public.notice_progress for insert to authenticated
with check (student_id = (select auth.uid()) and planner_private.can_read_notice(notice_id));
create policy progress_edit on public.notice_progress for update to authenticated
using (student_id = (select auth.uid()) and planner_private.can_read_notice(notice_id))
with check (student_id = (select auth.uid()) and planner_private.can_read_notice(notice_id));
create policy progress_delete on public.notice_progress for delete to authenticated
using (student_id = (select auth.uid()));

create policy events_own on public.planner_events for all to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));

-- This endpoint exposes only the schema version, never school or user data.
create function public.planner_health() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('schema_version', 1, 'table_count', 6);
$$;
revoke all on function public.planner_health() from public;
grant execute on function public.planner_health() to anon, authenticated;
commit;
