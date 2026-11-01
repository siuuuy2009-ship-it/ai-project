-- Upgrade the existing planner schema without deleting user data. Run once in SQL Editor.
begin;

alter table public.profiles add column if not exists clubs text[] not null default '{}';
alter table public.profiles add column if not exists student_number text;
alter table public.profiles add column if not exists school_initialized boolean not null default false;
alter table public.notices add column if not exists audience_keys text[];
alter table public.notices add column if not exists attachment jsonb;
alter table public.notice_progress add column if not exists excluded_from_planner boolean not null default false;
alter table public.notice_progress add column if not exists planner_title text;
alter table public.notice_progress add column if not exists planner_date date;
alter table public.planner_events drop constraint if exists planner_events_title_check;
alter table public.planner_events add constraint planner_events_title_check check (char_length(trim(title)) between 1 and 80);

create or replace function planner_private.school_data(metadata jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'grade', case when metadata->>'grade' ~ '^[1-3]$' then (metadata->>'grade')::integer end,
    'classroom', case when metadata->>'classroom' ~ '^([1-9]|[12][0-9]|30)$' then (metadata->>'classroom')::integer end,
    'student_number', case when metadata->>'student_number' ~ '^[0-9]{1,10}$' then metadata->>'student_number' end,
    'clubs', coalesce((select jsonb_agg(distinct value) from jsonb_array_elements_text(
      case when jsonb_typeof(metadata->'clubs') = 'array' then metadata->'clubs' else '[]'::jsonb end
    ) where value = any(array['파이','시그마','메트릭스','라이프','바이오','캠','별누리','무한상상','CC','첼C','블리츠','파인애플'])), '[]'::jsonb)
  );
$$;
revoke all on function planner_private.school_data(jsonb) from public, anon, authenticated;

update public.profiles p set
  display_name = coalesce(nullif(left(trim(u.raw_user_meta_data->>'display_name'),40),''), p.display_name),
  grade = (planner_private.school_data(u.raw_user_meta_data)->>'grade')::integer,
  classroom = (planner_private.school_data(u.raw_user_meta_data)->>'classroom')::integer,
  student_number = planner_private.school_data(u.raw_user_meta_data)->>'student_number',
  clubs = array(select jsonb_array_elements_text(planner_private.school_data(u.raw_user_meta_data)->'clubs')),
  school_initialized = true
from auth.users u where u.id = p.id and not p.school_initialized;

create or replace function planner_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare school jsonb := planner_private.school_data(new.raw_user_meta_data);
begin
  insert into public.profiles(id,display_name,grade,classroom,student_number,clubs,school_initialized)
  values(new.id,coalesce(nullif(left(trim(new.raw_user_meta_data->>'display_name'),40),''),'학생'),
    (school->>'grade')::integer,(school->>'classroom')::integer,school->>'student_number',
    array(select jsonb_array_elements_text(school->'clubs')),true);
  return new;
end;
$$;

update public.notices set audience_keys = case when group_id is null then array['all'] else array[group_id::text] end
where audience_keys is null;
alter table public.notices alter column audience_keys set not null;
alter table public.notices drop constraint if exists notices_audience_keys_check;
alter table public.notices add constraint notices_audience_keys_check check (cardinality(audience_keys) between 1 and 64);
alter table public.notices drop constraint if exists notices_attachment_check;
alter table public.notices add constraint notices_attachment_check check (
  attachment is null or (jsonb_typeof(attachment) = 'object' and octet_length(attachment::text) <= 1500000
    and char_length(attachment->>'name') between 1 and 200
    and attachment->>'dataUrl' ~ '^data:(application/[a-zA-Z0-9.+-]+|image/(png|jpeg));base64,[A-Za-z0-9+/=]+$')
);
alter table public.notice_progress drop constraint if exists progress_title_check;
alter table public.notice_progress add constraint progress_title_check check (planner_title is null or char_length(trim(planner_title)) between 1 and 80);

create or replace function planner_private.valid_audiences(keys text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select cardinality(keys) between 1 and 64 and not exists (
    select 1 from unnest(keys) k where k is null or not (
      k = 'all' or k ~ '^class-[1-3]-[1-6]$' or k ~ '^school-club-([1-9]|1[0-2])$'
      or exists(select 1 from public.groups g where g.id::text = k and g.owner_id = auth.uid())
    )
  );
$$;

create or replace function planner_private.can_read_notice(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.notices n join public.profiles p on p.id = auth.uid()
    where n.id = target and (n.author_id = auth.uid() or 'all' = any(n.audience_keys)
      or ('class-' || p.grade || '-' || p.classroom) = any(n.audience_keys)
      or exists (
        select 1 from unnest(array['파이','시그마','메트릭스','라이프','바이오','캠','별누리','무한상상','CC','첼C','블리츠','파인애플'])
          with ordinality as c(name,idx)
        where c.name = any(p.clubs) and ('school-club-' || c.idx) = any(n.audience_keys)
      ) or exists (
        select 1 from public.groups g where g.id::text = any(n.audience_keys) and (
          (g.kind = 'class' and g.grade = p.grade and g.classroom = p.classroom)
          or (g.kind = 'club' and g.club_name = any(p.clubs))
          or exists(select 1 from public.group_members m where m.group_id = g.id and m.student_id = p.id)
        )
      )
    )
  );
$$;
revoke all on function planner_private.valid_audiences(text[]) from public, anon;
grant execute on function planner_private.valid_audiences(text[]) to authenticated;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using (true);
drop policy if exists notices_create on public.notices;
drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices for select to authenticated
using (author_id = (select auth.uid()) or planner_private.can_read_notice(id));
create policy notices_create on public.notices for insert to authenticated with check (
  author_id = (select auth.uid()) and (select planner_private.is_teacher())
  and planner_private.valid_audiences(audience_keys) and group_id is null
);
drop policy if exists notices_edit on public.notices;
create policy notices_edit on public.notices for update to authenticated
using (author_id = (select auth.uid()) and (select planner_private.is_teacher()))
with check (author_id = (select auth.uid()) and planner_private.valid_audiences(audience_keys) and group_id is null);
grant update(audience_keys,attachment) on public.notices to authenticated;

create or replace function public.planner_health() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('schema_version',2,'table_count',6);
$$;
-- Older accounts without a school assignment may complete it once.
create or replace function public.planner_complete_profile(new_grade integer,new_classroom integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or new_grade not between 1 and 3 or new_classroom not between 1 and 6
    or new_grade is null or new_classroom is null then raise exception 'Invalid school assignment'; end if;
  update public.profiles set grade = new_grade,classroom = new_classroom
  where id = auth.uid() and grade is null and classroom is null and role = 'student';
  if not found then raise exception 'School assignment already exists'; end if;
end;
$$;
revoke all on function public.planner_complete_profile(integer,integer) from public,anon;
grant execute on function public.planner_complete_profile(integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
