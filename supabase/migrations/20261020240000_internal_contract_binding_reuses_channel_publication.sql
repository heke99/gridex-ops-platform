-- FINDINGS F57: when a superadmin publishes an offer to the internal channel,
-- gridex_publish_contract_channel locks a published gridex_contract_publication_v6
-- version for exactly that offer on the (assignment, internal) publication. A
-- manual customer contract on the same offer is bound by
-- gridex_ensure_internal_contract_publication, which only recognized its own
-- gridex_internal_publication_v1 snapshot hash, so it inserted a second
-- published version on the same publication and the one-published-per-
-- publication unique index refused it: no customer could be registered
-- manually on an internally published offer. The binding now reuses that
-- offer's published internal-channel version; offers never published to the
-- internal channel keep the existing compatibility path unchanged.
-- Body rewritten in place with metadata/OID preserved.
BEGIN;

DO $rewrite$DECLARE f record;
 target CONSTANT text:='public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)';
 needle CONSTANT text:=$n$  select id into v_assignment_id from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  order by created_at desc limit 1;$n$;
 replacement CONSTANT text:=$r$  select v.id into v_version_id
  from public.contract_publication_versions v
  join public.contract_publications p on p.id=v.contract_publication_id
  join public.tenant_contract_assignments a on a.id=p.assignment_id
  where a.company_id=p_company_id and a.contract_product_version_id=o.contract_product_version_id
    and p.channel='internal' and v.channel='internal' and v.status='published'
    and v.contract_product_version_id=o.contract_product_version_id
    and v.publication_snapshot->>'source_contract_offer_id'=o.id::text
  order by v.version_number desc limit 1;
  if v_version_id is not null then return v_version_id; end if;

  select id into v_assignment_id from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  order by created_at desc limit 1;$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
 -- The replacement ends with the needle, so the needle count cannot tell a second run apart: an already
 -- rewritten body (exactly one replacement) is left as it is; otherwise exactly one predecessor is required.
 IF (length(f.prosrc)-length(replace(f.prosrc,replacement,'')))/length(replacement)=1 THEN RETURN;END IF;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'internal_publication_reuse_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'internal_publication_reuse_metadata_changed';END IF;
END$rewrite$;

COMMIT;
