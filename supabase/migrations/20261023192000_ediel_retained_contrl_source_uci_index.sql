-- FINDINGS F106 part A (reality world 2026-10-23, scenario F run 26). Technical CONTRL replies to the grid owner were
-- lost under load: ediel_create_outbound_ack_atomic_v1 (mean 2.6 s), gridex_read_outbound_acks_for_source_v2 and
-- ediel_read_outbound_ack_replay_v1 ran into the 8 s PostgREST statement_timeout (57014) while holding or waiting for
-- their serializing table locks.
--
-- Measured cause: gridex_ediel_technical_ack.retained_source_v1 (called by read_outbound_originals_v1 and
-- require_contrl_v1, several times per CONTRL create/read) selected every ready technical source of the tenant whose
-- payload contains a release character ('?') anywhere. Every UTILTS E66 carries DTM+735:?+0200, so the 20261019043000
-- prefilter never narrowed: 123 of 131 sources reached the loop, each parsed character by character by
-- gridex_ediel_technical_ack.envelope (~4 ms), and each row was locked FOR SHARE.
--   retained_source_v1(contrl,true), tenant with 131 sources: 847 ms -> 13.6 ms (10 CONTRLs, same session);
--   read_outbound_originals_v1(source,'CONTRL'): 858 ms -> 54 ms with identical output (md5) on 10 sources.
--
-- The loop admits a source only when a->>'uciRef' = envelope(source.raw_payload)->>'uciReference'. That same
-- condition is added to the candidate query, where the existing expression index
-- ediel_messages_inbound_envelope_uci_idx (envelope(raw_payload)->>'uciReference' WHERE direction='inbound') serves
-- it. It is an exact necessary condition, not a heuristic: every row it removes fails the loop's own check, so the
-- returned source is unchanged (verified for all 439 outbound CONTRLs in the world: identical results for
-- complete_chain false and true). The earlier prefilter, the FOR SHARE locks on the admitted rows, ambiguity
-- refusal, complete-chain checks, owner, ACL, SECURITY DEFINER and search_path are unchanged.
-- Exact-needle body rewrite of the installed 20261019043000 body; metadata (owner, ACL, security, proconfig,
-- volatility) and the function OID are preserved and checked.
BEGIN;
DO $retained_contrl_uci_index$
DECLARE
 function_oid oid:=to_regprocedure('gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean)');
 before_metadata jsonb;after_metadata jsonb;body text;post_body text;definition text;
 pre_hash CONSTANT text:='77aa7bad7fe352374e6769110173d1804ea4c0c0c68865dc62b248e6525d09c6';
 post_hash CONSTANT text:='272fc2d16c1c236997778541b7e90d85447ed9111d01eced050cbf517b73772e';
 needle CONSTANT text:=$old$  ORDER BY s.id FOR SHARE OF b,r,s LOOP$old$;
 replacement CONSTANT text:=$new$   AND gridex_ediel_technical_ack.envelope(s.raw_payload)->>'uciReference'=a->>'uciRef'
  ORDER BY s.id FOR SHARE OF b,r,s LOOP$new$;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'ediel_retained_contrl_uci_index_function_missing';END IF;
 IF to_regclass('public.ediel_messages_inbound_envelope_uci_idx') IS NULL THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_expression_index_missing';END IF;
 SELECT to_jsonb(p)-'prosrc',p.prosrc INTO STRICT before_metadata,body FROM pg_catalog.pg_proc p WHERE p.oid=function_oid;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM pre_hash THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_preimage_changed';END IF;
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_replacement_shape_changed';END IF;
 post_body:=replace(body,needle,replacement);
 IF encode(sha256(convert_to(post_body,'UTF8')),'hex') IS DISTINCT FROM post_hash THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_definition_postimage_changed';END IF;
 definition:=pg_catalog.pg_get_functiondef(function_oid);
 IF length(definition)-length(replace(definition,body,''))<>length(body) THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_definition_shape_changed';END IF;
 definition:=replace(definition,body,post_body);
 EXECUTE definition;
 IF to_regprocedure('gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean)')::oid IS DISTINCT FROM function_oid THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_oid_changed';END IF;
 SELECT to_jsonb(p)-'prosrc',p.prosrc INTO STRICT after_metadata,body FROM pg_catalog.pg_proc p WHERE p.oid=function_oid;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM post_hash THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_catalog_postimage_changed';END IF;
 IF after_metadata IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'ediel_retained_contrl_uci_index_function_metadata_changed';END IF;
END
$retained_contrl_uci_index$;
COMMIT;
