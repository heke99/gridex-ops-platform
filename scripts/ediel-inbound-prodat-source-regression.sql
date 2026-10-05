-- Storage-boundary tests, not national PRODAT validation or live data.
-- Invoked by the unchanged ordinary clean-replay job through its existing
-- manual-inbound test entrypoint. All synthetic rows are rolled back.
begin;
create temporary table source_results (name text primary key, passed boolean not null) on commit drop;
insert into public.companies(id,name) values
 ('00000000-0000-4000-8000-00000000c001','PRODAT source regression A'),
 ('00000000-0000-4000-8000-00000000c002','PRODAT source regression B');

create function pg_temp.source_row(company uuid, env text, family text, payload text, supplied_hash text default null, standard text default 'edifact')
returns uuid language plpgsql as $$
declare result uuid; selected_profile public.ediel_message_profiles%rowtype; selected_pack public.ediel_rule_packs%rowtype;
begin
 -- The fixture explicitly supplies one existing profile, as prequalified
 -- ingress does. Code-only Z04 lookup is ambiguous across its five subtypes.
 -- No profiles or triggers are changed and no national validation is claimed.
 if family='PRODAT' then
  select * into strict selected_profile from public.ediel_message_profiles
   where profile_key='PRODAT:Z04:L:26.A:r3' and is_enabled;
  select * into strict selected_pack from public.ediel_rule_packs where id=selected_profile.rule_pack_id;
 end if;
 insert into public.ediel_messages(company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_payload_hash,message_received_at,created_at,
   canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 values(company,env,'inbound',standard,family,case when family='PRODAT' then 'Z04' else null end,'received',payload,supplied_hash,'2026-09-21T12:00:00Z','2026-09-21T12:00:00Z',
   selected_pack.id,selected_profile.profile_key,selected_profile.id,case when family='PRODAT' then selected_pack.guide_version||':r'||selected_pack.guide_revision else null end,
   selected_pack.source_hash,coalesce(selected_profile.profile,'{}'::jsonb))
 returning id into result;
 return result;
end $$;

do $$
declare
 company uuid; env text; payload text; supplied text; row_id uuid;
 r public.ediel_messages%rowtype; label text;
begin
 foreach company in array array['00000000-0000-4000-8000-00000000c001'::uuid,'00000000-0000-4000-8000-00000000c002'::uuid] loop
  foreach env in array array['test','production'] loop
   foreach payload in array array[E'UNH+SRC+PRODAT:D:96A:UN:E2SE6A\'FTX+AAI+++Åäö ?+?:??\'\r\n','',E' \t\r\n'] loop
    row_id:=pg_temp.source_row(company,env,'PRODAT',payload);
    select * into strict r from public.ediel_messages where id=row_id;
    label:=company::text||'/'||env||'/'||length(payload);
    insert into source_results values(label||'/exact-hash',coalesce(r.immutable_payload_hash=encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex'),false));
    insert into source_results values(label||'/exact-bytes',r.raw_payload is not distinct from payload);
    insert into source_results values(label||'/not-rendered',r.immutable_rendered_at is null);
   end loop;
  end loop;
 end loop;
 foreach supplied in array array['forged',repeat('0',64)] loop
  row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','PRODAT','received source',supplied);
  insert into source_results select 'replace-supplied-hash/'||supplied,immutable_payload_hash=encode(extensions.digest('received source','sha256'),'hex') from public.ediel_messages where id=row_id;
 end loop;
end $$;

-- Each mutation gets a fresh physical row: a failed baseline mutation cannot
-- contaminate later cases or manufacture the expected failure.
do $$
declare mutation text; row_id uuid; rejected boolean; observed text;
begin
 foreach mutation in array array['raw','raw-and-correct-new-hash','clear-raw','clear-hash','replace-hash','reclassify-and-raw'] loop
  row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','PRODAT','original source');
  rejected:=false; observed:=null;
  begin
   case mutation
    when 'raw' then update public.ediel_messages set raw_payload='changed source' where id=row_id;
    when 'raw-and-correct-new-hash' then update public.ediel_messages set raw_payload='changed source',immutable_payload_hash=encode(extensions.digest('changed source','sha256'),'hex') where id=row_id;
    when 'clear-raw' then update public.ediel_messages set raw_payload=null where id=row_id;
    when 'clear-hash' then update public.ediel_messages set immutable_payload_hash=null where id=row_id;
    when 'replace-hash' then update public.ediel_messages set immutable_payload_hash=repeat('1',64) where id=row_id;
    when 'reclassify-and-raw' then update public.ediel_messages set message_family='APERAK',raw_payload='changed source' where id=row_id;
   end case;
  exception when check_violation then
   observed:=sqlerrm;
   rejected:=observed='immutable_ediel_payload_cannot_change';
  end;
  insert into source_results values('mutation/'||mutation,rejected);
  insert into source_results select 'retained/'||mutation,coalesce(raw_payload='original source',false) from public.ediel_messages where id=row_id;
 end loop;
end $$;

do $$
declare row_id uuid; rejected boolean; r public.ediel_messages%rowtype;
begin
 row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','PRODAT','original source');
 update public.ediel_messages set parsed_payload='{"parse":"new diagnostic"}',validation_report='{"status":"internal_review"}',raw_payload='original source' where id=row_id;
 select * into strict r from public.ediel_messages where id=row_id;
 insert into source_results values('metadata-remains-writable',r.parsed_payload->>'parse'='new diagnostic' and r.validation_report->>'status'='internal_review');
 insert into source_results values('metadata-retains-hash',coalesce(r.immutable_payload_hash=encode(extensions.digest('original source','sha256'),'hex'),false));

 row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','PRODAT',null,'not-a-received-source');
 insert into source_results select 'null-is-not-sealed',immutable_payload_hash is null from public.ediel_messages where id=row_id;
 row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','PRODAT',null);
 update public.ediel_messages set raw_payload='later unqualified historical repair' where id=row_id;
 insert into source_results select 'updates-do-not-retroactively-seal',immutable_payload_hash is null from public.ediel_messages where id=row_id;

 row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','PRODAT','email diagnostic',null,'email');
 insert into source_results select 'email-diagnostic-not-sealed',immutable_payload_hash is null from public.ediel_messages where id=row_id;
 update public.ediel_messages set message_standard='edifact',raw_payload='later extracted source' where id=row_id;
 insert into source_results select 'email-diagnostic-reparse-not-retroactively-sealed',raw_payload='later extracted source' and immutable_payload_hash is null from public.ediel_messages where id=row_id;

 row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','APERAK','unsealed ACK');
 update public.ediel_messages set raw_payload='ACK compatibility control' where id=row_id;
 insert into source_results select 'non-PRODAT-unchanged',raw_payload='ACK compatibility control' and immutable_payload_hash is null from public.ediel_messages where id=row_id;

 row_id:=pg_temp.source_row('00000000-0000-4000-8000-00000000c001','test','APERAK','previously sealed',encode(extensions.digest('previously sealed','sha256'),'hex'));
 rejected:=false;
 begin update public.ediel_messages set raw_payload='attempted change' where id=row_id;
 exception when check_violation then rejected:=sqlerrm='immutable_ediel_payload_cannot_change'; end;
 insert into source_results values('pre-existing-seal-guard-retained',rejected);

 rejected:=false;
 begin perform pg_temp.source_row(null,'test','PRODAT','source');
 exception when not_null_violation then rejected:=sqlerrm='canonical_ediel_company_required'; end;
 insert into source_results values('company-required-before-insert',rejected);
 rejected:=false;
 begin perform pg_temp.source_row('00000000-0000-4000-8000-00000000c001','','PRODAT','source');
 exception when not_null_violation then rejected:=sqlerrm='canonical_ediel_environment_required'; end;
 insert into source_results values('environment-required-before-insert',rejected);
 rejected:=false;
 begin
  insert into public.ediel_messages(company_id,environment,direction,message_family,message_code,raw_payload)
  values('00000000-0000-4000-8000-00000000c001','test','outbound','PRODAT','Z01','outgoing source');
 exception when not_null_violation then rejected:=sqlerrm='canonical_ediel_rule_pack_required'; end;
 insert into source_results values('outbound-rule-pack-guard-retained',rejected);
end $$;

-- Service-role insertion uses the same real table/trigger, not a mocked writer.
set local role service_role;
select pg_temp.source_row('00000000-0000-4000-8000-00000000c002','production','PRODAT','service-role source') as service_source_id \gset
reset role;
insert into source_results select 'service-role-insert-sealed',coalesce(immutable_payload_hash=encode(extensions.digest('service-role source','sha256'),'hex'),false) from public.ediel_messages where id=:'service_source_id'::uuid;

select name,passed from source_results order by name;
do $$
declare failed text; total integer;
begin
 select count(*),string_agg(name,', ' order by name) filter(where not passed) into total,failed from source_results;
 if total<>62 then raise exception 'PRODAT_SOURCE_TEST_INVENTORY:%',total; end if;
 if failed is not null then raise exception 'PRODAT_SOURCE_BEHAVIOR_FAILURE:%',failed; end if;
 raise notice 'PRODAT_SOURCE_STORAGE_REGRESSION: 62/62 PASS';
end $$;
rollback;
