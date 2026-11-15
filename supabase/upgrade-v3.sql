-- Run after upgrade-v2.sql. Keeps existing accounts, notices and schedules.
begin;
alter table public.profiles add column if not exists subject_importance jsonb not null default '{}';
alter table public.profiles add column if not exists school_change_year integer not null default 0;
alter table public.profiles add column if not exists school_change_count integer not null default 0;

create or replace function planner_private.valid_subject_importance(value jsonb) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(value) <> 'object' then false else
    octet_length(value::text) <= 12000 and (select count(*) <= 100 and coalesce(bool_and(
      char_length(trim(key)) between 1 and 25 and jsonb_typeof(v) = 'number' and v::text ~ '^[1-5]$'
    ),true) from jsonb_each(value) as item(key,v)) end;
$$;
revoke all on function planner_private.valid_subject_importance(jsonb) from public,anon;
grant execute on function planner_private.valid_subject_importance(jsonb) to authenticated;
alter table public.profiles drop constraint if exists profiles_importance_check;
alter table public.profiles add constraint profiles_importance_check check (planner_private.valid_subject_importance(subject_importance));
alter table public.profiles drop constraint if exists profiles_school_change_count_check;
alter table public.profiles add constraint profiles_school_change_count_check check (school_change_count between 0 and 2);
grant update(subject_importance) on public.profiles to authenticated;

-- The counter is deliberately NOT writable by clients. Locking the caller's row
-- makes simultaneous requests share the same two-change annual allowance.
create or replace function planner_private.update_school(new_grade integer,new_classroom integer,new_clubs text[],new_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  p public.profiles%rowtype;
  current_year integer := extract(year from now() at time zone 'Asia/Seoul')::integer;
  normalized_clubs text[];
  used integer;
  changed boolean;
begin
  if caller is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if new_grade is null or new_grade not between 1 and 3 or new_classroom is null or new_classroom not between 1 and 30
    or new_clubs is null or cardinality(new_clubs)>12 or array_position(new_clubs,null) is not null
    or not new_clubs <@ array['파이','시그마','메트릭스','라이프','바이오','캠','별누리','무한상상','CC','첼C','블리츠','파인애플']::text[]
    or new_display_name is null or char_length(trim(new_display_name)) not between 1 and 40 then
    raise exception 'INVALID_SCHOOL_PROFILE' using errcode='22023';
  end if;
  select coalesce(array_agg(distinct c order by c),'{}'::text[]) into normalized_clubs from unnest(new_clubs) c;
  select * into p from public.profiles where id=caller for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='42501'; end if;
  used := case when p.school_change_year=current_year then p.school_change_count else 0 end;
  changed := p.grade is distinct from new_grade or p.classroom is distinct from new_classroom
    or array(select distinct c from unnest(p.clubs) c order by c) is distinct from normalized_clubs;
  if changed and p.grade is not null and p.classroom is not null then
    if used>=2 then raise exception 'SCHOOL_CHANGE_LIMIT' using errcode='P0001'; end if;
    used := used+1;
  end if;
  update public.profiles set display_name=trim(new_display_name),grade=new_grade,classroom=new_classroom,
    clubs=normalized_clubs,school_initialized=true,school_change_year=current_year,school_change_count=used where id=caller;
  return jsonb_build_object('year',current_year,'used',used,'remaining',2-used);
end;
$$;
revoke all on function planner_private.update_school(integer,integer,text[],text) from public,anon;
grant execute on function planner_private.update_school(integer,integer,text[],text) to authenticated;

create or replace function public.planner_update_school(new_grade integer,new_classroom integer,new_clubs text[],new_display_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select planner_private.update_school(new_grade,new_classroom,new_clubs,new_display_name);
$$;
revoke all on function public.planner_update_school(integer,integer,text[],text) from public,anon;
grant execute on function public.planner_update_school(integer,integer,text[],text) to authenticated;

create or replace function public.planner_health() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('schema_version',3,'table_count',6,'school_year',extract(year from now() at time zone 'Asia/Seoul')::integer);
$$;
notify pgrst,'reload schema';
commit;
