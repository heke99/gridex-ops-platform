begin;

create or replace function public.gridex_guard_meter_reading_series_tenant()
returns trigger language plpgsql set search_path=public as $$
declare v_company uuid;
begin
  new.version_no := coalesce(new.version_no,1);
  if new.source_ediel_message_id is not null then
    select company_id into v_company from public.ediel_messages where id=new.source_ediel_message_id;
    if v_company is distinct from new.company_id then
      raise exception 'meter_reading_series_source_tenant_mismatch' using errcode='23514';
    end if;
  end if;
  if new.supersedes_series_id is not null then
    select company_id into v_company from public.meter_reading_series where id=new.supersedes_series_id;
    if v_company is distinct from new.company_id then
      raise exception 'meter_reading_series_supersedes_tenant_mismatch' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

commit;
