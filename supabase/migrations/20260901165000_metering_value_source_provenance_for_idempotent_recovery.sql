create table if not exists public.metering_value_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metering_value_id uuid not null references public.metering_values(id) on delete cascade,
  normalized_metering_value_id uuid not null references public.normalized_metering_values(id) on delete cascade,
  source_ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  source_transaction_reference text,
  source_line_reference text,
  source_type text not null default 'ediel_utilts',
  created_at timestamptz not null default now(),
  unique (company_id, metering_value_id, source_ediel_message_id, source_transaction_reference, source_line_reference)
);

create index if not exists idx_metering_value_sources_source_message
  on public.metering_value_sources(company_id, source_ediel_message_id);
create index if not exists idx_metering_value_sources_metering_value
  on public.metering_value_sources(company_id, metering_value_id);

create or replace function public.gridex_guard_metering_value_source_tenant_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.metering_values mv
    where mv.id = new.metering_value_id and mv.company_id = new.company_id
  ) then
    raise exception 'metering_value_source_metering_value_tenant_mismatch' using errcode='23503';
  end if;
  if not exists (
    select 1 from public.normalized_metering_values nmv
    where nmv.id = new.normalized_metering_value_id and nmv.company_id = new.company_id
  ) then
    raise exception 'metering_value_source_normalized_value_tenant_mismatch' using errcode='23503';
  end if;
  if not exists (
    select 1 from public.ediel_messages em
    where em.id = new.source_ediel_message_id and em.company_id = new.company_id
  ) then
    raise exception 'metering_value_source_ediel_message_tenant_mismatch' using errcode='23503';
  end if;
  return new;
end;
$$;

drop trigger if exists metering_value_sources_tenant_guard_v1 on public.metering_value_sources;
create trigger metering_value_sources_tenant_guard_v1
before insert or update on public.metering_value_sources
for each row execute function public.gridex_guard_metering_value_source_tenant_v1();

alter table public.metering_value_sources enable row level security;
revoke all on public.metering_value_sources from anon, authenticated;
grant all on public.metering_value_sources to service_role;
