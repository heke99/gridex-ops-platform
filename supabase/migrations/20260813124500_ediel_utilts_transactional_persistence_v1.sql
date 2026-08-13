begin;

-- The active UTILTS 25-A-3 planning matrix supplied for this delivery.  This
-- extends the existing canonical registry; it deliberately does not invent
-- operation/request matrix classifications or field-511 tuple masterdata.
delete from public.ediel_field_rules
where message_family='UTILTS'
  and message_code in ('S02','S03','S04')
  and (
    rule_key like 'utilts_25_a_3_%'
    or source_document='user_supplied_utilts_25_a_3_planning_matrix_2026_08_13'
  );

with message_codes(code, idx) as (
  values ('S02', 1), ('S03', 2), ('S04', 3)
), field_matrix(field_no, field_key, field_label, segment_path, reqs) as (
  values
    ('505','transaction_identity','Transaction id','IDE+24',array['R','R','R']),
    ('209','metering_point','Metering point','LOC+172',array['R','X','X']),
    ('260a','net_area','Metering grid area','LOC+239',array['R','R','R']),
    ('262','balance_responsible','Balance responsible','NAD+DDK',array['X','D','D']),
    ('510','balance_supplier','Balance supplier','NAD+DDQ',array['X','D','X']),
    ('506','product_id','Product id','LIN/C212/7140',array['R','R','R']),
    ('511','time_series_product','Time-series product','PIA+1',array['X','R','R']),
    ('245','delivery_period','Delivery period','DTM+324',array['R','R','R']),
    ('532','latest_update_date','Latest update date','DTM+368',array['R','R','R']),
    ('508','resolution','Resolution','DTM+354',array['R','R','R']),
    ('223','reason_for_transaction','Reason for transaction','STS+7',array['R','R','R']),
    ('264','unit','Unit','MEA+AAZ',array['R','R','R']),
    ('226','prodat_transaction_reference','PRODAT transaction reference','RFF+LI',array['O','X','X']),
    ('254','settlement_method','Settlement method','CCI++E02/CAV',array['X','R','X']),
    ('513','metering_point_type','Metering point type','CCI++E12/CAV',array['X','R','X']),
    ('507a','default_metering_point_count','Default metering point count','CCI++Z01/CAV',array['X','D','X']),
    ('514','observation_id','Observation id','SEQ/C286/1050',array['R','R','R']),
    ('515','planned_periodic_quantity','Planned periodic quantity','QTY+135',array['R','R','R']),
    ('520','quantity_quality','Quantity quality','STS+8',array['D','X','X']),
    ('507b','diverging_metering_point_count','Diverging metering point count','CCI++Z01/CAV',array['X','D','X'])
)
insert into public.ediel_field_rules(
  rule_key,message_family,message_code,field_code,field_number,field_key,
  field_name,field_name_en,field_name_sv,field_label,segment_path,requirement,
  dependency_note,direction,environment,version,is_active,enabled,
  source_document,rule_payload,valid_from,created_at,updated_at
)
select
  'utilts_25_a_3_' || lower(message_codes.code) || '_' || lower(field_matrix.field_no),
  'UTILTS',message_codes.code,field_matrix.field_no,field_matrix.field_no,
  field_matrix.field_key,field_matrix.field_label,field_matrix.field_label,
  field_matrix.field_label,field_matrix.field_label,field_matrix.segment_path,
  field_matrix.reqs[message_codes.idx],
  case when field_matrix.reqs[message_codes.idx]='D'
    then '25-A-3 product-, actor- och transaktionsberoende regel' end,
  'both','all','25-A-3',true,true,
  'user_supplied_utilts_25_a_3_planning_matrix_2026_08_13',
  jsonb_build_object(
    'scope','transaction','matrixRequirement',field_matrix.reqs[message_codes.idx],
    'edielFieldNumber',field_matrix.field_no,
    'source','user_supplied_utilts_25_a_3_planning_matrix_2026_08_13'
  ),
  date '2025-06-01',now(),now()
from field_matrix cross join message_codes;

alter table public.meter_reading_series
  add column if not exists message_code text,
  add column if not exists source_transaction_reference text,
  add column if not exists series_kind text not null default 'actual',
  add column if not exists product_id text,
  add column if not exists time_series_product jsonb,
  add column if not exists actor_context jsonb not null default '{}'::jsonb,
  add column if not exists registration_date timestamptz,
  add column if not exists latest_update_date timestamptz,
  add column if not exists version_no integer not null default 1,
  add column if not exists supersedes_series_id uuid references public.meter_reading_series(id) on delete restrict,
  add column if not exists is_current boolean not null default true,
  add column if not exists correction_reason text,
  add column if not exists raw_transaction jsonb not null default '{}'::jsonb,
  add column if not exists immutable_hash text;

alter table public.meter_reading_series
  drop constraint if exists meter_reading_series_series_kind_check;
alter table public.meter_reading_series
  add constraint meter_reading_series_series_kind_check
  check (series_kind in ('actual','forecast','aggregate','request'));
alter table public.meter_reading_series
  drop constraint if exists meter_reading_series_version_no_check;
alter table public.meter_reading_series
  add constraint meter_reading_series_version_no_check check(version_no > 0);

alter table public.meter_reading_values
  add column if not exists observation_id text,
  add column if not exists qualifier text,
  add column if not exists raw_value text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.ediel_ack_transaction_results
  add column if not exists disposition text,
  add column if not exists planned_response_type text,
  add column if not exists issue_codes text[] not null default '{}'::text[],
  add column if not exists persistence_status text not null default 'not_applicable',
  add column if not exists persisted_series_id uuid references public.meter_reading_series(id) on delete set null,
  add column if not exists persistence_error text;

alter table public.ediel_ack_transaction_results
  drop constraint if exists ediel_ack_transaction_results_disposition_check;
alter table public.ediel_ack_transaction_results
  add constraint ediel_ack_transaction_results_disposition_check
  check(disposition is null or disposition in ('accepted','syntax_rejected','guide_rejected','processability_rejected'));
alter table public.ediel_ack_transaction_results
  drop constraint if exists ediel_ack_transaction_results_planned_response_check;
alter table public.ediel_ack_transaction_results
  add constraint ediel_ack_transaction_results_planned_response_check
  check(planned_response_type is null or planned_response_type in ('positive_aperak','negative_contrl','negative_aperak','utilts_err'));
alter table public.ediel_ack_transaction_results
  drop constraint if exists ediel_ack_transaction_results_persistence_status_check;
alter table public.ediel_ack_transaction_results
  add constraint ediel_ack_transaction_results_persistence_status_check
  check(persistence_status in ('not_applicable','pending','persisted','failed'));

create index if not exists meter_reading_series_current_object_period_idx
  on public.meter_reading_series(company_id,series_kind,external_metering_point_id,grid_area_id,period_start,period_end)
  where is_current;
create index if not exists meter_reading_series_current_message_code_idx
  on public.meter_reading_series(company_id,message_code,period_start desc)
  where is_current;
create index if not exists ediel_ack_transaction_results_source_disposition_idx
  on public.ediel_ack_transaction_results(company_id,source_message_id,disposition);

create or replace function public.gridex_guard_meter_reading_series_tenant()
returns trigger language plpgsql set search_path=public as $$
declare v_company uuid;
begin
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

drop trigger if exists meter_reading_series_tenant_guard on public.meter_reading_series;
create trigger meter_reading_series_tenant_guard
before insert or update on public.meter_reading_series
for each row execute function public.gridex_guard_meter_reading_series_tenant();

create or replace function public.gridex_guard_meter_reading_value_tenant()
returns trigger language plpgsql set search_path=public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.meter_reading_series where id=new.series_id;
  if v_company is distinct from new.company_id then
    raise exception 'meter_reading_value_series_tenant_mismatch' using errcode='23514';
  end if;
  return new;
end $$;

drop trigger if exists meter_reading_values_tenant_guard on public.meter_reading_values;
create trigger meter_reading_values_tenant_guard
before insert or update on public.meter_reading_values
for each row execute function public.gridex_guard_meter_reading_value_tenant();

create or replace function public.gridex_guard_immutable_meter_reading_series()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'meter_reading_series_is_immutable' using errcode='55000'; end if;
  if (to_jsonb(new)-'is_current') is distinct from (to_jsonb(old)-'is_current') then
    raise exception 'meter_reading_series_is_immutable' using errcode='55000';
  end if;
  return new;
end $$;

drop trigger if exists meter_reading_series_immutable_guard on public.meter_reading_series;
create trigger meter_reading_series_immutable_guard
before update or delete on public.meter_reading_series
for each row execute function public.gridex_guard_immutable_meter_reading_series();

create or replace function public.gridex_guard_immutable_meter_reading_value()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'meter_reading_value_is_immutable' using errcode='55000';
end $$;

drop trigger if exists meter_reading_values_immutable_guard on public.meter_reading_values;
create trigger meter_reading_values_immutable_guard
before update or delete on public.meter_reading_values
for each row execute function public.gridex_guard_immutable_meter_reading_value();

create or replace function public.gridex_persist_utilts_transactions_v1(
  p_company_id uuid,
  p_environment text,
  p_source_message_id uuid,
  p_message_code text,
  p_transactions jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_source public.ediel_messages%rowtype;
  v_item jsonb;
  v_transaction_id text;
  v_disposition text;
  v_response_type text;
  v_dedupe_key text;
  v_series_identity text;
  v_series_id uuid;
  v_previous_id uuid;
  v_version integer;
  v_inserted boolean;
  v_quantity jsonb;
  v_order integer;
  v_results jsonb := '[]'::jsonb;
  v_error text;
begin
  if p_environment not in ('test','production') then raise exception 'utilts_environment_invalid'; end if;
  if jsonb_typeof(p_transactions) <> 'array' then raise exception 'utilts_transactions_must_be_array'; end if;

  select * into v_source from public.ediel_messages where id=p_source_message_id for share;
  if not found or v_source.message_family <> 'UTILTS' then raise exception 'utilts_source_message_missing'; end if;
  if v_source.company_id is distinct from p_company_id or v_source.environment is distinct from p_environment then
    raise exception 'utilts_source_tenant_or_environment_mismatch' using errcode='23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_transactions)
  loop
    v_transaction_id := nullif(btrim(v_item->>'transactionId'),'');
    v_disposition := coalesce(nullif(v_item->>'disposition',''),'processability_rejected');
    v_response_type := coalesce(nullif(v_item->>'responseType',''),'utilts_err');
    if v_transaction_id is null then v_transaction_id := 'transaction-' || (jsonb_array_length(v_results)+1)::text; end if;

    insert into public.ediel_ack_transaction_results(
      company_id,environment,source_message_id,source_transaction_id,
      syntax_result,guide_validation_result,processability_result,
      disposition,planned_response_type,issue_codes,persistence_status,updated_at
    ) values (
      p_company_id,p_environment,p_source_message_id,v_transaction_id,
      case when v_disposition='syntax_rejected' then 'negative' else 'positive' end,
      case when v_disposition='guide_rejected' then 'negative' when v_disposition='syntax_rejected' then 'pending' else 'positive' end,
      case when v_disposition='processability_rejected' then 'negative' when v_disposition='accepted' then 'positive' else 'not_applicable' end,
      v_disposition,v_response_type,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'issueCodes','[]'::jsonb))),array[]::text[]),
      case when v_disposition='accepted' then 'pending' else 'not_applicable' end,now()
    ) on conflict(company_id,environment,source_message_id,source_transaction_id)
    do update set
      syntax_result=excluded.syntax_result,
      guide_validation_result=excluded.guide_validation_result,
      processability_result=excluded.processability_result,
      disposition=excluded.disposition,
      planned_response_type=excluded.planned_response_type,
      issue_codes=excluded.issue_codes,
      persistence_status=excluded.persistence_status,
      persisted_series_id=null,
      persistence_error=null,
      updated_at=now();

    if v_disposition <> 'accepted' then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition',v_disposition,
        'responseType',v_response_type,'persistenceStatus','not_applicable'
      ));
      continue;
    end if;

    begin
      v_series_identity := concat_ws('|',p_company_id::text,coalesce(v_item->>'seriesKind','actual'),
        p_message_code,coalesce(v_item->>'externalMeteringPointId',''),coalesce(v_item->>'gridAreaId',''),
        coalesce(v_item->>'periodStart',''),coalesce(v_item->>'periodEnd',''),
        coalesce(v_item->>'resolution','UNKNOWN'),coalesce(v_item->>'productId',''));
      perform pg_advisory_xact_lock(hashtextextended(v_series_identity,0));
      v_dedupe_key := encode(digest(convert_to(v_series_identity || '|' || v_transaction_id,'UTF8'),'sha256'),'hex');
      v_previous_id := null;
      v_version := 1;
      select id,version_no into v_previous_id,v_version
      from public.meter_reading_series
      where company_id=p_company_id and is_current
        and series_kind=coalesce(v_item->>'seriesKind','actual')
        and coalesce(message_code,'')=coalesce(p_message_code,'')
        and coalesce(external_metering_point_id,'')=coalesce(v_item->>'externalMeteringPointId','')
        and coalesce(grid_area_id,'')=coalesce(v_item->>'gridAreaId','')
        and period_start is not distinct from nullif(v_item->>'periodStart','')::timestamptz
        and period_end is not distinct from nullif(v_item->>'periodEnd','')::timestamptz
        and resolution=coalesce(v_item->>'resolution','UNKNOWN')
        and coalesce(product_id,'')=coalesce(v_item->>'productId','')
        and dedupe_key<>v_dedupe_key
      order by version_no desc limit 1 for update;
      if v_previous_id is not null then v_version := v_version + 1; end if;

      insert into public.meter_reading_series(
        company_id,metering_point_id,source_ediel_message_id,external_metering_point_id,
        grid_area_id,period_start,period_end,resolution,unit,quality_status,dedupe_key,
        message_code,source_transaction_reference,series_kind,product_id,time_series_product,
        actor_context,registration_date,latest_update_date,version_no,supersedes_series_id,
        is_current,correction_reason,raw_transaction,immutable_hash
      ) values (
        p_company_id,nullif(v_item->>'meteringPointId','')::uuid,p_source_message_id,
        nullif(v_item->>'externalMeteringPointId',''),nullif(v_item->>'gridAreaId',''),
        nullif(v_item->>'periodStart','')::timestamptz,nullif(v_item->>'periodEnd','')::timestamptz,
        coalesce(nullif(v_item->>'resolution',''),'UNKNOWN'),coalesce(nullif(v_item->>'unit',''),'KWH'),
        'received',v_dedupe_key,p_message_code,v_transaction_id,coalesce(v_item->>'seriesKind','actual'),
        nullif(v_item->>'productId',''),v_item->'timeSeriesProduct',coalesce(v_item->'actorContext','{}'::jsonb),
        nullif(v_item->>'registrationDate','')::timestamptz,nullif(v_item->>'latestUpdateDate','')::timestamptz,
        v_version,v_previous_id,true,nullif(v_item->>'correctionReason',''),v_item,
        encode(digest(convert_to(v_item::text,'UTF8'),'sha256'),'hex')
      ) on conflict(company_id,dedupe_key) do nothing returning id into v_series_id;
      v_inserted := v_series_id is not null;
      if not v_inserted then
        select id into v_series_id from public.meter_reading_series
        where company_id=p_company_id and dedupe_key=v_dedupe_key;
      else
        if v_previous_id is not null then
          update public.meter_reading_series set is_current=false where id=v_previous_id;
        end if;
        v_order := 0;
        for v_quantity in select value from jsonb_array_elements(coalesce(v_item->'quantities','[]'::jsonb))
        loop
          v_order := v_order + 1;
          insert into public.meter_reading_values(
            company_id,series_id,reading_at,quantity,unit,quality,source_order,
            observation_id,qualifier,raw_value,metadata
          ) values (
            p_company_id,v_series_id,nullif(v_quantity->>'readingAt','')::timestamptz,
            nullif(v_quantity->>'value','')::numeric,coalesce(nullif(v_item->>'unit',''),'KWH'),
            coalesce(nullif(v_quantity->>'quality',''),'unknown'),v_order,
            coalesce(nullif(v_quantity->>'observationId',''),v_order::text),
            nullif(v_quantity->>'qualifier',''),v_quantity->>'raw',coalesce(v_quantity->'metadata','{}'::jsonb)
          );
        end loop;
      end if;

      update public.ediel_ack_transaction_results set
        persistence_status='persisted',persisted_series_id=v_series_id,persistence_error=null,updated_at=now()
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','accepted','responseType','positive_aperak',
        'persistenceStatus','persisted','seriesId',v_series_id,'idempotentReplay',not v_inserted
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      update public.ediel_ack_transaction_results set
        disposition='processability_rejected',planned_response_type='utilts_err',
        processability_result='negative',persistence_status='failed',persistence_error=left(v_error,500),
        issue_codes=array_append(issue_codes,'UTILTS_PERSISTENCE_FAILED'),updated_at=now()
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','processability_rejected','responseType','utilts_err',
        'persistenceStatus','failed','issueCodes',jsonb_build_array('UTILTS_PERSISTENCE_FAILED')
      ));
    end;
  end loop;
  return v_results;
end $$;

revoke all on function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) to service_role;

alter table public.meter_reading_series enable row level security;
alter table public.meter_reading_values enable row level security;
alter table public.ediel_ack_transaction_results enable row level security;

commit;
