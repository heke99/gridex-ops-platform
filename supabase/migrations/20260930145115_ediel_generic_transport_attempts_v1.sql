-- TR02/TR03/TR10: all-family SMTP journal; SMTP entry never claims acceptance.
-- Z08's H-specific closure/witness authority is preserved in its separate source owner.
-- Private prospective metadata only: no inferred originals, retention or activation.
begin;
create schema gridex_ediel_transport;
revoke all on schema gridex_ediel_transport from public,anon,authenticated;
grant usage on schema gridex_ediel_transport to service_role;

create table gridex_ediel_transport.attempts (
 id uuid primary key, message_id uuid not null references public.ediel_messages(id) on delete restrict,
 company_id uuid not null references public.companies(id) on delete restrict,
 environment text not null check(environment in ('test','production')),
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 owner jsonb not null, binding jsonb not null,
 created_at timestamptz not null default now(), entered_at timestamptz,
 observed_at timestamptz, classification text, provider_result jsonb,
 unique(message_id,id),
 check(classification is null or classification in ('accepted','partial','all_rejected','explicit_negative','pre_connect_negative','unknown')),
 check((observed_at is null)=(classification is null))
);
create index ediel_transport_attempts_owner_idx on gridex_ediel_transport.attempts(company_id,environment,message_id);
create index ediel_transport_attempts_rfc_idx on gridex_ediel_transport.attempts(company_id,environment,(binding->>'rfcMessageId'),(binding->>'to'));
create table gridex_ediel_transport.reservations (
 message_id uuid primary key references public.ediel_messages(id) on delete restrict,
 attempt_id uuid not null references gridex_ediel_transport.attempts(id) on delete restrict,
 state text not null check(state in ('prepared','entered','observed','released'))
);
alter table gridex_ediel_transport.attempts enable row level security;
alter table gridex_ediel_transport.attempts force row level security;
alter table gridex_ediel_transport.reservations enable row level security;
alter table gridex_ediel_transport.reservations force row level security;
revoke all on gridex_ediel_transport.attempts,gridex_ediel_transport.reservations from public,anon,authenticated,service_role;
-- Only the owner functions mutate journal rows; service_role has no direct reset/edit privilege.

create function gridex_ediel_transport.mutate_v1(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 c uuid:=(p_input->>'companyId')::uuid; env text:=p_input->>'environment'; mid uuid:=(p_input->>'messageId')::uuid;
 actor uuid:=(p_input->>'actorUserId')::uuid; aid uuid:=(p_input->>'attemptId')::uuid; action text:=p_input->>'action';
 owner jsonb:=p_input->'owner'; binding jsonb:=p_input->'binding'; result jsonb:=p_input->'result';
 m public.ediel_messages%rowtype; a gridex_ediel_transport.attempts%rowtype; r gridex_ediel_transport.reservations%rowtype; v_classification text; lane jsonb;
begin
 if c is null or actor is null or mid is null or aid is null or env is null or env not in ('test','production') or action is null or action not in ('prepare','enter','observe','release') then raise exception 'ediel_transport_scope_required'; end if;
 -- A global administrator alone is not a tenant service context.
 if not exists(select 1 from public.company_memberships x where x.company_id=c and x.user_id=actor and x.status='active' and x.is_active and x.accepted_at is not null)
 or not exists(select 1 from public.user_profiles x where x.id=actor and x.user_status='active')
 or not coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false)
 or not exists(select 1 from public.canonical_tenant_operation_decision(c,case when env='production' then 'ediel.production.send' else 'ediel.test.process' end) d where d.allowed) then raise exception 'ediel_transport_actor_not_authorized' using errcode='42501'; end if;
 select * into strict m from public.ediel_messages where id=mid and company_id=c and environment=env for update;
 if m.direction is distinct from 'outbound' or m.message_standard is distinct from 'edifact' or m.raw_payload is null or m.immutable_rendered_at is null or m.immutable_payload_hash is distinct from encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 then raise exception 'ediel_transport_sealed_message_required'; end if;
 if action in ('prepare','enter') then perform public.ediel_require_scoped_capability_for_message_v1(c,mid); end if;
 if action='prepare' then
  -- Ask the existing source owner with an intentionally non-sendable probe.
  -- H, malformed/inconsistent Z08 and existing closure originals remain in that lane.
  -- The invalid owner cannot reach any write if the old authority returns scoped.
  lane:=gridex_outbound_dispatch.mutate_v1(jsonb_build_object('companyId',c,'environment',env,'messageId',mid,'actorUserId',actor,'attemptId',aid,'action','prepare','owner',jsonb_build_object('kind','transport_scope_probe')));
  if (lane->>'scoped')::boolean is distinct from false then raise exception 'ediel_transport_special_source_authority_required'; end if;
  if jsonb_typeof(owner) is distinct from 'object' or owner->>'kind' is null or owner->>'kind' not in ('direct','worker') or jsonb_typeof(binding) is distinct from 'object'
  or binding->>'originalHash' is distinct from m.immutable_payload_hash or binding->>'routeId' is distinct from m.communication_route_id::text or binding->>'to' is distinct from m.receiver_email
  or nullif(binding->>'from','') is null or coalesce(binding->>'payloadHash','') !~ '^[a-f0-9]{64}$' or coalesce(binding->>'mimeSha256','') !~ '^[a-f0-9]{64}$'
  or nullif(binding->>'rfcMessageId','') is null or nullif(binding->>'mimeArchiveRef','') is null or (binding->>'mimeLength')::bigint is null or (binding->>'mimeLength')::bigint<=0
  or (binding->>'payloadLength')::bigint is null or (binding->>'payloadLength')::bigint<=0 or (binding->>'payloadLength')::bigint>262144
  or nullif(binding->>'mimeMode','') is null or nullif(binding->>'encoding','') is null then raise exception 'ediel_transport_binding_invalid'; end if;
  -- The archive writer must have committed and read back the same exact MIME bytes before provider entry.
  if not exists(select 1 from public.ediel_message_payloads x where x.company_id=c and x.ediel_message_id=mid and x.encrypted_payload_ref=binding->>'mimeArchiveRef'
    and x.payload_kind in ('raw_mime','smime_enveloped') and x.metadata->>'archive_verified'='true' and x.metadata->>'archived_mime_sha256'=binding->>'mimeSha256'
    and x.metadata->>'archived_rfc_message_id'=binding->>'rfcMessageId' and (x.metadata->>'archived_mime_bytes')::bigint=(binding->>'mimeLength')::bigint) then raise exception 'ediel_transport_archive_not_qualified'; end if;
  select * into r from gridex_ediel_transport.reservations where message_id=mid for update;
  if found and r.state<>'released' then
   select * into strict a from gridex_ediel_transport.attempts where id=r.attempt_id;
   if a.company_id<>c or a.environment<>env or a.binding->>'originalHash' is distinct from m.immutable_payload_hash then raise exception 'ediel_transport_original_changed'; end if;
   return jsonb_build_object('proceed',false,'state',r.state,'classification',a.classification,'providerReceipt',case when a.classification='accepted' then a.provider_result else null end,'observedAt',a.observed_at);
  end if;
  if owner->>'kind'='worker' then
   perform 1 from public.ediel_outbox o where o.id=(owner->>'outboxId')::uuid and o.ediel_message_id=mid and o.company_id=c and o.environment=env and o.status='sending' and o.current_send_attempt_id=(owner->>'sendAttemptId')::uuid and o.locked_by=owner->>'workerId' for update;
   if not found then raise exception 'ediel_transport_worker_fence_lost'; end if;
  elsif owner is distinct from '{"kind":"direct"}'::jsonb then raise exception 'ediel_transport_direct_owner_invalid'; end if;
  insert into gridex_ediel_transport.attempts(id,message_id,company_id,environment,actor_user_id,owner,binding) values(aid,mid,c,env,actor,owner,binding);
  insert into gridex_ediel_transport.reservations(message_id,attempt_id,state) values(mid,aid,'prepared') on conflict(message_id) do update set attempt_id=excluded.attempt_id,state='prepared';
  return jsonb_build_object('proceed',true,'state','prepared');
 end if;
 select * into strict r from gridex_ediel_transport.reservations where message_id=mid for update;
 if r.attempt_id is distinct from aid then raise exception 'ediel_transport_stale_attempt'; end if;
 select * into strict a from gridex_ediel_transport.attempts where id=aid and message_id=mid and company_id=c and environment=env and actor_user_id=actor for update;
 if action='enter' then
  if r.state<>'prepared' then return jsonb_build_object('proceed',false,'state',r.state); end if;
  if a.owner->>'kind'='worker' then
   perform 1 from public.ediel_outbox o where o.id=(a.owner->>'outboxId')::uuid and o.ediel_message_id=mid and o.company_id=c and o.environment=env and o.status='sending' and o.current_send_attempt_id=(a.owner->>'sendAttemptId')::uuid and o.locked_by=a.owner->>'workerId' for update;
   if not found then raise exception 'ediel_transport_worker_fence_lost'; end if;
  end if;
  update gridex_ediel_transport.attempts set entered_at=now() where id=aid;
  update gridex_ediel_transport.reservations set state='entered' where message_id=mid;
  return jsonb_build_object('proceed',true,'state','entered');
 elsif action='release' then
  if r.state<>'prepared' or a.entered_at is not null then raise exception 'ediel_transport_release_unsafe'; end if;
  update gridex_ediel_transport.reservations set state='released' where message_id=mid;
  return jsonb_build_object('proceed',true,'state','released');
 end if;
 if jsonb_typeof(result) is distinct from 'object' or octet_length(result::text)>262144 or r.state not in ('entered','observed') then raise exception 'ediel_transport_result_invalid'; end if;
 if r.state='observed' then
  if result is distinct from a.provider_result then raise exception 'ediel_transport_result_immutable'; end if;
  return jsonb_build_object('classification',a.classification,'state','observed','observedAt',a.observed_at);
 end if;
 v_classification:='unknown';
 if jsonb_typeof(result->'accepted')='array' and jsonb_typeof(result->'rejected')='array' and not exists(select 1 from jsonb_array_elements((result->'accepted')||(result->'rejected')) x where jsonb_typeof(x)<>'string' or nullif(btrim(x#>>'{}'),'') is null) then
  if jsonb_array_length(result->'accepted')>0 and not exists(select 1 from jsonb_array_elements_text(result->'accepted') accepted where lower(accepted)<>lower(a.binding->>'to')) then
   v_classification:=case when jsonb_array_length(result->'rejected')=0 then 'accepted' else 'partial' end;
  elsif jsonb_array_length(result->'accepted')=0 and jsonb_array_length(result->'rejected')>0 then v_classification:='all_rejected'; end if;
 elsif result#>>'{error,syscall}'='connect' then v_classification:='pre_connect_negative';
 elsif result#>>'{error,responseCode}' ~ '^[45][0-9][0-9]$' then v_classification:='explicit_negative'; end if;
 update gridex_ediel_transport.attempts set observed_at=now(),provider_result=result,classification=v_classification where id=aid;
 update gridex_ediel_transport.reservations set state='observed' where message_id=mid;
 return jsonb_build_object('classification',v_classification,'state','observed','observedAt',now());
end;
$$;
revoke all on function gridex_ediel_transport.mutate_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function gridex_ediel_transport.mutate_v1(jsonb) to service_role;
create function public.gridex_ediel_transport_attempt_v1(p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'ediel_transport_service_required' using errcode='42501'; end if;
 return gridex_ediel_transport.mutate_v1(p_input);
end; $$;
revoke all on function public.gridex_ediel_transport_attempt_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gridex_ediel_transport_attempt_v1(jsonb) to service_role;

create function gridex_ediel_transport.dsn_candidates_v1(p_company_id uuid,p_environment text,p_rfc_message_id text,p_final_recipient text,p_mailbox_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_company_id is null or p_environment is null or p_environment not in ('test','production') or nullif(btrim(p_rfc_message_id),'') is null or nullif(btrim(p_final_recipient),'') is null or p_mailbox_id is null then raise exception 'ediel_dsn_scope_required'; end if;
 if not exists(select 1 from public.ediel_mailboxes b where b.id=p_mailbox_id and b.environment=p_environment and b.is_active and (b.company_id=p_company_id or b.company_id is null and b.is_shared_platform_mailbox)) then raise exception 'ediel_dsn_mailbox_scope_invalid'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('attemptId',a.id,'messageId',a.message_id,'environment',a.environment,'enteredAt',a.entered_at,'observedAt',a.observed_at,'smtpClassification',a.classification,'correlationStatus','unverified') order by a.created_at,a.id)
 from gridex_ediel_transport.attempts a where a.company_id=p_company_id and a.environment=p_environment and a.entered_at is not null and a.binding->>'rfcMessageId'=p_rfc_message_id and lower(a.binding->>'to')=lower(p_final_recipient)),'[]'::jsonb);
end;
$$;
revoke all on function gridex_ediel_transport.dsn_candidates_v1(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function gridex_ediel_transport.dsn_candidates_v1(uuid,text,text,text,uuid) to service_role;
create function public.gridex_ediel_dsn_attempt_candidates_v1(p_company_id uuid,p_environment text,p_rfc_message_id text,p_final_recipient text,p_mailbox_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'ediel_transport_service_required' using errcode='42501'; end if;
 return gridex_ediel_transport.dsn_candidates_v1(p_company_id,p_environment,p_rfc_message_id,p_final_recipient,p_mailbox_id);
end; $$;
revoke all on function public.gridex_ediel_dsn_attempt_candidates_v1(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.gridex_ediel_dsn_attempt_candidates_v1(uuid,text,text,text,uuid) to service_role;
commit;
