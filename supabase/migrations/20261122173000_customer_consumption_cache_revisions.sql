create table public.customer_consumption_cache_revisions (
  company_id uuid not null,
  customer_id uuid not null,
  facility_id text not null,
  revision uuid not null default gen_random_uuid(),
  primary key (company_id, customer_id, facility_id)
);
alter table public.customer_consumption_cache_revisions enable row level security;
revoke all on table public.customer_consumption_cache_revisions from public, anon, authenticated, service_role;
grant select on table public.customer_consumption_cache_revisions to service_role;

create function public.gridex_mark_consumption_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    delete from public.customer_consumption_cache_revisions;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.customer_consumption_cache_revisions (company_id, customer_id, facility_id)
    select company_id, customer_id, facility_id from (
      select company_id, customer_id, facility_id from previous_values
      union
      select company_id, customer_id, facility_id from current_values
    ) affected
    where customer_id is not null and facility_id is not null
    order by company_id, customer_id, facility_id
    on conflict (company_id, customer_id, facility_id) do update set revision = excluded.revision;
  elsif tg_op = 'DELETE' then
    insert into public.customer_consumption_cache_revisions (company_id, customer_id, facility_id)
    select distinct company_id, customer_id, facility_id from previous_values
    where customer_id is not null and facility_id is not null
    order by company_id, customer_id, facility_id
    on conflict (company_id, customer_id, facility_id) do update set revision = excluded.revision;
  else
    insert into public.customer_consumption_cache_revisions (company_id, customer_id, facility_id)
    select distinct company_id, customer_id, facility_id from current_values
    where customer_id is not null and facility_id is not null
    order by company_id, customer_id, facility_id
    on conflict (company_id, customer_id, facility_id) do update set revision = excluded.revision;
  end if;
  return null;
end;
$$;

revoke all on function public.gridex_mark_consumption_revision_v1() from public, anon, authenticated, service_role;

create trigger gridex_consumption_revision_insert after insert on public.normalized_metering_values
referencing new table as current_values for each statement execute function public.gridex_mark_consumption_revision_v1();
create trigger gridex_consumption_revision_update after update on public.normalized_metering_values
referencing old table as previous_values new table as current_values
for each statement execute function public.gridex_mark_consumption_revision_v1();
create trigger gridex_consumption_revision_delete after delete on public.normalized_metering_values
referencing old table as previous_values for each statement execute function public.gridex_mark_consumption_revision_v1();
create trigger gridex_consumption_revision_truncate after truncate on public.normalized_metering_values
for each statement execute function public.gridex_mark_consumption_revision_v1();

insert into public.customer_consumption_cache_revisions (company_id, customer_id, facility_id)
select distinct company_id, customer_id, facility_id from public.normalized_metering_values
where customer_id is not null and facility_id is not null
on conflict do nothing;
