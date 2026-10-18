-- First Z04/C cancellation of a confirmed own start uses the same protected
-- current sender registry owner as the first Z05/C restoration. Z05/C keeps its
-- exact guard and reason. The new guard follows the retained-transition replay
-- return, so historical recorded outcomes and idempotent replays keep their
-- original truth, and precedes every lock-then-mutate step of the owner.
-- A second distinct Z04/C against a start already cancelled by an earlier own
-- C is held as z04c_start_already_cancelled: it can neither rebind the
-- switch's inbound_z04_message_id/completed_at nor be misreported as an
-- executed-effect compensation. Replay of the same C still returns above.
-- Preserve exact original/correlation checks, caller graph-lock order and all
-- existing effect partitions and privileges.
BEGIN;
DO $sender$DECLARE f record;body text;
 z05c_guard CONSTANT text:=$guard$ -- Only a first Z05/C restoration requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z05' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z05c_current_sender_network_registry_required');END IF;
 END IF;
$guard$;
 z04c_guard CONSTANT text:=$guard$ -- Only a first Z04/C cancellation requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z04' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z04c_current_sender_network_registry_required');END IF;
 END IF;
$guard$;
 status_check CONSTANT text:=$needle$   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;$needle$;
 duplicate_guard CONSTANT text:=$guard$   -- A start already cancelled by another own C is a held duplicate.
   IF sw.status='cancelled_before_start' THEN RETURN jsonb_build_object('applied',false,'reason','z04c_start_already_cancelled');END IF;
$guard$;
BEGIN
 PERFORM 'gridex_network_registry_sources.network_for_company_v1(uuid,text,text)'::regprocedure;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition
 INTO STRICT f FROM pg_proc p
 WHERE p.oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'aab2d2f6dcbfe17e31f92c07a70c9f9346396a2c1435a5976b1d70c8e58cb2b7'
  OR (length(f.prosrc)-length(replace(f.prosrc,z05c_guard,'')))/length(z05c_guard)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,status_check,'')))/length(status_check)<>1
  OR position(z04c_guard IN f.prosrc)>0 OR position(duplicate_guard IN f.prosrc)>0
  THEN RAISE EXCEPTION 'z04c_sender_registry_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,z05c_guard,z05c_guard||z04c_guard),status_check,duplicate_guard||status_check);
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM 'e2bba947e4ade9d3a1128cc826f6b43b336da0733ba35d90eb43b498f53e350e'
  OR replace(replace(body,z04c_guard,''),duplicate_guard,'') IS DISTINCT FROM f.prosrc
  THEN RAISE EXCEPTION 'z04c_sender_registry_inverse_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM 'e2bba947e4ade9d3a1128cc826f6b43b336da0733ba35d90eb43b498f53e350e'
  THEN RAISE EXCEPTION 'z04c_sender_registry_metadata_or_postimage_changed';END IF;
END$sender$;
COMMIT;
