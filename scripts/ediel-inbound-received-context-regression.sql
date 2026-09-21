-- Real row/trigger tests in the disposable ordinary replay, never production.
-- No trigger disabling, historical backfill, profile changes or role widening.
begin;
create temporary table receive_context_results(name text primary key, passed boolean not null) on commit drop;
create function pg_temp.context_check(label text, result boolean) returns void language plpgsql as $$
begin insert into receive_context_results values(label,coalesce(result,false)); end $$;
insert into public.companies(id,name) values
 ('00000000-0000-4000-8000-00000000d001','Receive context A'),
 ('00000000-0000-4000-8000-00000000d002','Receive context B');
create function pg_temp.context_row(company uuid, env text, payload text default 'original source', stamp timestamptz default '2026-06-20T11:00:00.123456+02:00',
 snapshot jsonb default '{"other":"retained"}', family text default 'PRODAT', standard text default 'edifact')
returns uuid language plpgsql as $$
declare result uuid; profile public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype;
begin
 if family='PRODAT' then
  select * into strict profile from public.ediel_message_profiles where profile_key='PRODAT:Z04:L:26.A:r3' and is_enabled;
  select * into strict pack from public.ediel_rule_packs where id=profile.rule_pack_id;
 end if;
 insert into public.ediel_messages(company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,execution_context_snapshot,
 canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 values(company,env,'inbound',standard,family,case when family='PRODAT' then 'Z04' else null end,'received',payload,stamp,snapshot,
 pack.id,profile.profile_key,profile.id,case when family='PRODAT' then pack.guide_version||':r'||pack.guide_revision else null end,pack.source_hash,coalesce(profile.profile,'{}'::jsonb))
 returning id into result;
 return result;
end $$;

do $$
declare company uuid; env text; payload text; row_id uuid; ctx jsonb; r public.ediel_messages%rowtype; label text; started timestamptz;
begin
 foreach company in array array['00000000-0000-4000-8000-00000000d001'::uuid,'00000000-0000-4000-8000-00000000d002'::uuid] loop
  foreach env in array array['test','production'] loop
   foreach payload in array array['',E'UNH+SRC+PRODAT:D:96A:UN:E2SE6A\'FTX+AAI+++Åäö ?+?:??\'\r\n'] loop
    started:=clock_timestamp(); row_id:=pg_temp.context_row(company,env,payload);
    select * into strict r from public.ediel_messages where id=row_id;
    ctx:=r.execution_context_snapshot->'receivedProdatContext'; label:=company::text||'/'||env||'/'||length(payload);
    perform pg_temp.context_check(label||'/fields',ctx - 'capturedAt' = jsonb_build_object(
      'version',1,'contextOrigin','database_insert','sourceMessageId',row_id,'companyId',company,'environment',env,'messageCode','Z04',
      'payloadHash',r.immutable_payload_hash,'sourceReceivedAt',r.message_received_at));
    perform pg_temp.context_check(label||'/source-seal',ctx->>'payloadHash'=encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex'));
    perform pg_temp.context_check(label||'/capture-clock',(ctx->>'capturedAt')::timestamptz between started and clock_timestamp());
    perform pg_temp.context_check(label||'/other-keys',r.execution_context_snapshot->>'other'='retained');
   end loop;
  end loop;
 end loop;
 row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test','original source','2026-06-20T09:00:00.123456Z',
   '{"other":"retained","receivedProdatContext":{"version":1,"companyId":"FORGED","payloadHash":"FORGED","capturedAt":"1999-01-01T00:00:00Z"}}');
 select execution_context_snapshot->'receivedProdatContext' into ctx from public.ediel_messages where id=row_id;
 perform pg_temp.context_check('insert-spoof-overridden',ctx->>'companyId'='00000000-0000-4000-8000-00000000d001'
   and ctx->>'payloadHash'=encode(extensions.digest('original source','sha256'),'hex') and ctx->>'sourceMessageId'=row_id::text);
end $$;

do $$
declare change text; row_id uuid; before_ctx jsonb; rejected boolean;
begin
 foreach change in array array['remove','replace','json-null','parent-null','parent-array','parent-scalar','nested-company','nested-time'] loop
  row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test');
  select execution_context_snapshot->'receivedProdatContext' into before_ctx from public.ediel_messages where id=row_id;
  rejected:=false;
  begin
   case change
    when 'remove' then update public.ediel_messages set execution_context_snapshot=execution_context_snapshot-'receivedProdatContext' where id=row_id;
    when 'replace' then update public.ediel_messages set execution_context_snapshot=jsonb_build_object('receivedProdatContext','forged') where id=row_id;
    when 'json-null' then update public.ediel_messages set execution_context_snapshot=jsonb_build_object('receivedProdatContext',null) where id=row_id;
    when 'parent-null' then update public.ediel_messages set execution_context_snapshot=null where id=row_id;
    when 'parent-array' then update public.ediel_messages set execution_context_snapshot='[]'::jsonb where id=row_id;
    when 'parent-scalar' then update public.ediel_messages set execution_context_snapshot='"forged"'::jsonb where id=row_id;
    when 'nested-company' then update public.ediel_messages set execution_context_snapshot=jsonb_set(execution_context_snapshot,'{receivedProdatContext,companyId}','"OTHER"') where id=row_id;
    when 'nested-time' then update public.ediel_messages set execution_context_snapshot=jsonb_set(execution_context_snapshot,'{receivedProdatContext,sourceReceivedAt}','"1999-01-01T00:00:00Z"') where id=row_id;
   end case;
  exception when others then rejected:=sqlstate='23514' and sqlerrm='immutable_ediel_received_context_cannot_change'; end;
  perform pg_temp.context_check('leaf/'||change||'/rejected',rejected);
  perform pg_temp.context_check('leaf/'||change||'/retained',(select execution_context_snapshot->'receivedProdatContext'=before_ctx from public.ediel_messages where id=row_id));
 end loop;
end $$;

do $$
declare change text; row_id uuid; rejected boolean; expected text; r public.ediel_messages%rowtype;
begin
 foreach change in array array['time-forward','time-backward','time-null','id','direction','standard','family','code','raw','seal'] loop
  row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test');
  expected:=case when change like 'time-%' then 'immutable_ediel_receipt_time_cannot_change'
    when change in ('raw','seal') then 'immutable_ediel_payload_cannot_change' else 'immutable_ediel_received_context_cannot_change' end;
  rejected:=false;
  begin
   case change
    when 'time-forward' then update public.ediel_messages set message_received_at='2026-06-20T09:00:00.123457Z' where id=row_id;
    when 'time-backward' then update public.ediel_messages set message_received_at='2026-06-20T09:00:00.123455Z' where id=row_id;
    when 'time-null' then update public.ediel_messages set message_received_at=null where id=row_id;
    when 'id' then update public.ediel_messages set id=gen_random_uuid() where id=row_id;
    when 'direction' then update public.ediel_messages set direction='outbound' where id=row_id;
    when 'standard' then update public.ediel_messages set message_standard='email' where id=row_id;
    when 'family' then update public.ediel_messages set message_family='OTHER' where id=row_id;
    when 'code' then update public.ediel_messages set message_code='Z06' where id=row_id;
    when 'raw' then update public.ediel_messages set raw_payload='different' where id=row_id;
    when 'seal' then update public.ediel_messages set immutable_payload_hash=repeat('0',64) where id=row_id;
   end case;
  exception when others then rejected:=sqlstate='23514' and sqlerrm=expected; end;
  perform pg_temp.context_check('field/'||change||'/rejected',rejected);
  select * into r from public.ediel_messages where id=row_id;
  perform pg_temp.context_check('field/'||change||'/retained',r.id=row_id and r.direction='inbound' and r.message_standard='edifact'
    and r.message_family='PRODAT' and r.message_code='Z04' and r.raw_payload='original source'
    and r.message_received_at='2026-06-20T09:00:00.123456Z'::timestamptz and r.immutable_payload_hash=encode(extensions.digest('original source','sha256'),'hex'));
 end loop;
end $$;

do $$
declare row_id uuid; before_ctx jsonb; new_ctx jsonb; r public.ediel_messages%rowtype; rejected boolean; snapshot jsonb;
begin
 row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test');
 select execution_context_snapshot->'receivedProdatContext' into before_ctx from public.ediel_messages where id=row_id;
 update public.ediel_messages set message_received_at='2026-06-20T11:00:00.123456+02:00',
   execution_context_snapshot=execution_context_snapshot||'{"other":"changed","newDiagnostic":true}',parsed_payload='{"reparsed":true}' where id=row_id;
 select * into strict r from public.ediel_messages where id=row_id;
 perform pg_temp.context_check('same-instant-and-diagnostics',r.execution_context_snapshot->'receivedProdatContext'=before_ctx
   and r.execution_context_snapshot->>'other'='changed' and r.parsed_payload->>'reparsed'='true');
 -- A first metadata change cannot erase the original context and enable a later rewrite.
 update public.ediel_messages set company_id='00000000-0000-4000-8000-00000000d002',environment='production' where id=row_id;
 select execution_context_snapshot->'receivedProdatContext' into new_ctx from public.ediel_messages where id=row_id;
 perform pg_temp.context_check('operational-reassignment-preserves-original',new_ctx=before_ctx and new_ctx->>'companyId'='00000000-0000-4000-8000-00000000d001' and new_ctx->>'environment'='test');
 rejected:=false;
 begin update public.ediel_messages set message_received_at=clock_timestamp() where id=row_id;
 exception when others then rejected:=sqlstate='23514' and sqlerrm='immutable_ediel_receipt_time_cannot_change'; end;
 perform pg_temp.context_check('two-step-reassignment-cannot-rewrite-time',rejected);

 -- Legacy/no-source rows must not acquire a forged context through an UPDATE.
 row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test',null);
 perform pg_temp.context_check('null-raw-no-context',(select not coalesce(execution_context_snapshot?'receivedProdatContext',false) from public.ediel_messages where id=row_id));
 foreach snapshot in array array['{"receivedProdatContext":null}'::jsonb,'{"receivedProdatContext":{"version":1}}'::jsonb] loop
  rejected:=false;
  begin update public.ediel_messages set execution_context_snapshot=snapshot where id=row_id;
  exception when others then rejected:=sqlstate='23514' and sqlerrm='received_ediel_context_cannot_be_backfilled'; end;
  perform pg_temp.context_check('cannot-introduce/'||snapshot::text,rejected);
 end loop;
 update public.ediel_messages set raw_payload='later historical repair',message_received_at='2026-06-21T09:00:00Z' where id=row_id;
 perform pg_temp.context_check('later-raw-never-backfilled',(select immutable_payload_hash is null and not coalesce(execution_context_snapshot?'receivedProdatContext',false) from public.ediel_messages where id=row_id));
 row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test','original source',null,'{"receivedProdatContext":{"forged":true},"other":"kept"}');
 perform pg_temp.context_check('null-time-no-context-or-fabricated-time',(select message_received_at is null and not coalesce(execution_context_snapshot?'receivedProdatContext',false) and execution_context_snapshot->>'other'='kept' from public.ediel_messages where id=row_id));
 update public.ediel_messages set message_received_at='2026-06-20T09:00:00Z' where id=row_id;
 perform pg_temp.context_check('later-time-never-backfilled',(select not coalesce(execution_context_snapshot?'receivedProdatContext',false) from public.ediel_messages where id=row_id));
 row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test','unsealed','2026-06-20T09:00:00Z','{"receivedProdatContext":null,"other":"kept"}','APERAK');
 perform pg_temp.context_check('non-PRODAT-spoof-removed',(select not coalesce(execution_context_snapshot?'receivedProdatContext',false) and execution_context_snapshot->>'other'='kept' from public.ediel_messages where id=row_id));
 row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test','diagnostic','2026-06-20T09:00:00Z','{"receivedProdatContext":{"forged":true}}','PRODAT','email');
 perform pg_temp.context_check('non-edifact-spoof-removed',(select not coalesce(execution_context_snapshot?'receivedProdatContext',false) from public.ediel_messages where id=row_id));
end $$;

-- Real service-role invocation of the unchanged table/trigger privileges.
create function pg_temp.context_service_mutation(source_id uuid, change text) returns text language plpgsql as $$
begin
 begin
  if change='time' then update public.ediel_messages set message_received_at=clock_timestamp() where id=source_id;
  else update public.ediel_messages set execution_context_snapshot='{}' where id=source_id; end if;
 exception when others then return sqlstate||':'||sqlerrm; end;
 return 'NO_ERROR';
end $$;
set local role service_role;
select pg_temp.context_row('00000000-0000-4000-8000-00000000d002','production') as service_context_id \gset
select pg_temp.context_service_mutation(:'service_context_id'::uuid,'time') as service_time_error \gset
select pg_temp.context_service_mutation(:'service_context_id'::uuid,'context') as service_context_error \gset
reset role;
select pg_temp.context_check('service-insert-captured',(select execution_context_snapshot->'receivedProdatContext'->>'companyId'='00000000-0000-4000-8000-00000000d002' from public.ediel_messages where id=:'service_context_id'::uuid));
select pg_temp.context_check('service-time-rejected',:'service_time_error'='23514:immutable_ediel_receipt_time_cannot_change');
select pg_temp.context_check('service-context-rejected',:'service_context_error'='23514:immutable_ediel_received_context_cannot_change');
select name,passed from receive_context_results order by name;
do $$
declare failed text; total integer;
begin
 select count(*),string_agg(name,', ' order by name) filter(where not passed) into total,failed from receive_context_results;
 if total<>83 then raise exception 'PRODAT_RECEIVE_CONTEXT_INVENTORY:%',total; end if;
 if failed is not null then raise exception 'PRODAT_RECEIVE_CONTEXT_FAILURE:%',failed; end if;
 raise notice 'PRODAT_RECEIVE_CONTEXT_REGRESSION: 83/83 PASS';
end $$;
rollback;
