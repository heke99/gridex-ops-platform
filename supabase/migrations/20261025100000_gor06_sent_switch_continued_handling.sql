-- FINDINGS GOR-06 / owner decision 27 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md): the dispatch guard
-- must tell a NEW dispatch from continued handling of a switch whose Z03 is already sent, and a positive final
-- CONTRL+APERAK moves a sent switch from 'prepared' to 'submitted' (sent and acknowledged; never confirmed or active).
--
-- 1. public.gridex_guard_supplier_switch_dispatch() (trigger zz_supplier_switch_dispatch_readiness; exact pre-image
--    2d19ebb5..., refused otherwise with gor06_dispatch_guard_pre_image_changed; owner, ACL, security, volatility and
--    configuration preserved and checked): the readiness re-check (gridex_assert_supplier_switch_ready) is skipped only
--    for an UPDATE of a switch whose Z03 original was already bound (old.outbound_z03_message_id) and stays the same,
--    with an unchanged contract binding. An INSERT, a first or changed Z03 binding and any contract change are still
--    checked exactly as before. Answers to a sent switch (acks, Z04, rejections, cancellations) are no longer refused
--    by a readiness change after sending (for example a later withdrawal).
-- 2. public.gridex_record_switch_final_ack_v1(company, switch, source message): the only path 'prepared' -> 'submitted'.
--    Same writer check as gridex_transition_supplier_switch_v1 (gridex_assert_switch_writer_v1, tenant-scoped row lock).
--    Compare-and-set: applies only when the message is the switch's own bound Z03, the switch is 'prepared' and the Z03's
--    canonical ack state is 'aperak_received_positive'; status, submitted_at and one event are written in one
--    transaction. Any other state returns applied=false with the reason and writes nothing, so a duplicate or replay has
--    no side effect. It never sets 'accepted' (Z04, normal_switch_confirm_v1) or any supply state.
begin;

do $gor06$
declare
  fn constant regprocedure := 'public.gridex_guard_supplier_switch_dispatch()'::regprocedure;
  pre_image constant text := '2d19ebb55c7c6327b12b63f345dd53be59e29771284a9095f2723659a7d808cf';
  old_text constant text := $old$  v_contract_id:=coalesce($old$;
  new_text constant text := $new$  -- GOR-06 (20261025100000): continued handling of an already sent switch is not a new dispatch.
  if tg_op='UPDATE' and old.outbound_z03_message_id is not null
    and new.outbound_z03_message_id is not distinct from old.outbound_z03_message_id
    and new.contract_id is not distinct from old.contract_id
    and new.customer_contract_id is not distinct from old.customer_contract_id then
    return new;
  end if;
  v_contract_id:=coalesce($new$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = fn;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from pre_image
    or (length(f.prosrc) - length(replace(f.prosrc, old_text, ''))) / length(old_text) <> 1
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'gor06_dispatch_guard_pre_image_changed' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, old_text, new_text);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'gor06_dispatch_guard_metadata_changed' using errcode = 'P0U01';
  end if;
end
$gor06$;

create function public.gridex_record_switch_final_ack_v1(p_company_id uuid, p_switch_id uuid, p_source_message_id uuid, p_actor_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  v_switch public.supplier_switch_requests%rowtype;
  v_ack text;
  v_after public.supplier_switch_requests%rowtype;
begin
  perform public.gridex_assert_switch_writer_v1(p_company_id);
  select * into v_switch from public.supplier_switch_requests
  where id = p_switch_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'supplier_switch_not_found_for_tenant';
  end if;
  if p_source_message_id is null or v_switch.outbound_z03_message_id is distinct from p_source_message_id then
    return jsonb_build_object('applied', false, 'reason', 'not_the_switch_original', 'status', v_switch.status);
  end if;
  if v_switch.status is distinct from 'prepared' then
    return jsonb_build_object('applied', false, 'reason', 'status_' || coalesce(v_switch.status, 'null'), 'status', v_switch.status);
  end if;
  select v.canonical_ack_state into v_ack from public.ediel_message_ack_state_v v
  where v.id = p_source_message_id and v.company_id = p_company_id;
  if v_ack is distinct from 'aperak_received_positive' then
    return jsonb_build_object('applied', false, 'reason', 'final_positive_ack_missing', 'ackState', v_ack, 'status', v_switch.status);
  end if;
  update public.supplier_switch_requests
     set status = 'submitted', submitted_at = coalesce(submitted_at, now()), updated_at = now(),
         updated_by = coalesce(p_actor_user_id, updated_by)
   where id = p_switch_id and company_id = p_company_id
  returning * into v_after;
  insert into public.supplier_switch_events (switch_request_id, event_type, event_status, message, payload, company_id, created_by)
  values (p_switch_id, 'ediel_ack_received', 'submitted',
    'Ediel-kvittens mottagen. Z03 är skickad och tekniskt och applikationsmässigt kvitterad; nätägarens Z04 återstår.',
    jsonb_build_object('sourceEdielMessageId', p_source_message_id, 'ackState', v_ack, 'previous_status', v_switch.status, 'new_status', v_after.status),
    p_company_id, p_actor_user_id);
  return jsonb_build_object('applied', true, 'status', v_after.status, 'submittedAt', v_after.submitted_at);
end
$fn$;

revoke all on function public.gridex_record_switch_final_ack_v1(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.gridex_record_switch_final_ack_v1(uuid, uuid, uuid, uuid) to authenticated, service_role;

commit;
