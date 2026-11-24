-- Apply the price evidence owner together with its migration receipt.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_pricing_evidence_migration$
BEGIN
create schema gridex_locked_pricing_evidence;
revoke all on schema gridex_locked_pricing_evidence from public;
revoke all on schema gridex_locked_pricing_evidence from anon,authenticated,service_role;

create table gridex_locked_pricing_evidence.run_seals (
  company_id uuid not null,
  run_id uuid not null,
  underlay_id uuid not null,
  evidence_count bigint not null,
  evidence_digest bytea not null,
  primary key(company_id,run_id),
  foreign key(run_id) references public.pricing_runs(id) on delete cascade
);

create function gridex_locked_pricing_evidence.canonical(source jsonb) returns jsonb
language sql set search_path = pg_catalog, pg_temp as $$
select jsonb_build_array(
  (source->>'id')::uuid,
  (source->>'billingUnderlayItemId')::uuid,
  to_char((source->>'meteringIntervalStart')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
  to_char((source->>'meteringIntervalEnd')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
  source->>'resolution',
  trim_scale((source->>'consumptionKwh')::numeric),
  trim_scale((source->>'priceSekPerKwh')::numeric),
  trim_scale((source->>'amountExVat')::numeric),
  (source->>'priceSourceId')::uuid,
  source->>'priceArea',
  source->>'evidenceSha256',
  source->'priceSourceIds'
);
$$;

create function gridex_locked_pricing_evidence.seal_digest(tenant uuid, underlay uuid, run uuid, source jsonb) returns bytea
language sql set search_path = pg_catalog, pg_temp as $$
select sha256(convert_to(jsonb_build_array('pricing-interval-scope-proof-v1',tenant,underlay,run,
  coalesce((select jsonb_agg(gridex_locked_pricing_evidence.canonical(e.value) order by e.ordinality)
    from jsonb_array_elements(source) with ordinality e), '[]'::jsonb)
)::text, 'UTF8'));
$$;

create function gridex_locked_pricing_evidence.source_rows(tenant uuid, underlay uuid, run uuid) returns jsonb
language sql set search_path = pg_catalog, pg_temp as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'billingUnderlayItemId',billing_underlay_item_id,
  'meteringIntervalStart',metering_interval_start,'meteringIntervalEnd',metering_interval_end,
  'resolution',resolution,'consumptionKwh',consumption_kwh,'priceSekPerKwh',price_sek_per_kwh,
  'amountExVat',amount_ex_vat,'priceSourceId',price_source_id,'priceArea',price_area,'evidenceSha256',evidence_sha256,'priceSourceIds',to_jsonb(e)->'price_source_ids'
) order by metering_interval_start,id), '[]'::jsonb)
from public.pricing_interval_evidence e where company_id=tenant and pricing_run_id=run and billing_underlay_id=underlay;
$$;

-- Model the existing canonical input capture as a trusted input-ID set from the
-- qualified writer. This is deliberately unwired and never callable by service_role.
create function gridex_locked_pricing_evidence.capture(tenant uuid, underlay uuid, run uuid, qualified_input_ids uuid[]) returns void
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  input_rows uuid[];
  expected uuid[];
  evidence jsonb;
begin
  perform from public.pricing_runs p where p.company_id=tenant and p.billing_underlay_id=underlay and p.id=run
    and p.status='needs_review' for update;
  if not found or qualified_input_ids is null then
    raise exception 'proof_qualified_writer_scope_missing' using errcode='55000';
  end if;
  select coalesce(array_agg(q order by q),'{}') into expected from unnest(qualified_input_ids) q;
  select coalesce(array_agg(billing_underlay_item_id order by billing_underlay_item_id),'{}') into input_rows
    from public.pricing_interval_evidence e where company_id=tenant and billing_underlay_id=underlay and pricing_run_id=run;
  if expected is distinct from input_rows then
    raise exception 'proof_persist_input_coverage_mismatch' using errcode='55000';
  end if;
  evidence := gridex_locked_pricing_evidence.source_rows(tenant,underlay,run);
  insert into gridex_locked_pricing_evidence.run_seals(company_id,run_id,underlay_id,evidence_count,evidence_digest)
    values(tenant,run,underlay,jsonb_array_length(evidence),gridex_locked_pricing_evidence.seal_digest(tenant,underlay,run,evidence));
end
$$;

CREATE FUNCTION gridex_locked_pricing_evidence.assert_draft(
 tenant uuid, items jsonb, enrichment jsonb
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 snapshot jsonb:=enrichment->'calculation_snapshot';
 evidence jsonb:=snapshot->'interval_evidence';
 target_run_id uuid:=(snapshot->>'pricing_run_id')::uuid;
 underlay uuid:=(snapshot->>'billing_underlay_id')::uuid;
 sealed gridex_locked_pricing_evidence.run_seals%ROWTYPE;
BEGIN
 IF jsonb_array_length(items) IS DISTINCT FROM 1
  OR (items->0->>'id')::uuid IS DISTINCT FROM (enrichment->>'invoice_export_item_id')::uuid
  OR (items->0->>'company_id')::uuid IS DISTINCT FROM tenant
  OR (items->0->>'pricing_run_id')::uuid IS DISTINCT FROM target_run_id
  OR (items->0->>'billing_underlay_id')::uuid IS DISTINCT FROM underlay
 THEN RAISE EXCEPTION 'proof_snapshot_scope_mismatch' USING ERRCODE='55000'; END IF;
 PERFORM FROM public.pricing_runs p WHERE p.company_id=tenant AND p.id=target_run_id AND p.billing_underlay_id=underlay
   AND p.status='locked' FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'proof_locked_run_not_current' USING ERRCODE='55000'; END IF;
 SELECT * INTO sealed FROM gridex_locked_pricing_evidence.run_seals p
  WHERE p.company_id=tenant AND p.run_id=target_run_id AND p.underlay_id=underlay;
 IF NOT FOUND THEN RAISE EXCEPTION 'proof_authoritative_seal_missing' USING ERRCODE='55000'; END IF;
 IF jsonb_typeof(evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(evidence)<>sealed.evidence_count THEN
   RAISE EXCEPTION 'proof_evidence_count_mismatch' USING ERRCODE='55000'; END IF;
 IF gridex_locked_pricing_evidence.seal_digest(tenant,underlay,target_run_id,evidence)<>sealed.evidence_digest THEN
   RAISE EXCEPTION 'proof_evidence_digest_mismatch' USING ERRCODE='55000'; END IF;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_locked_pricing_evidence FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_protect_locked_pricing_evidence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,pg_temp AS $$
DECLARE
  target_run_id uuid;
  source_status text;
  parent_company_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_run_id := NEW.pricing_run_id;
  ELSE
    target_run_id := OLD.pricing_run_id;
    IF TG_OP = 'UPDATE' AND (
      NEW.pricing_run_id, NEW.company_id, NEW.billing_underlay_id
    ) IS DISTINCT FROM (
      OLD.pricing_run_id, OLD.company_id, OLD.billing_underlay_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='pricing_evidence_parent_immutable';
    END IF;
  END IF;

  -- An approved existing parent removal can legitimately cascade to these rows.
  IF TG_OP = 'DELETE' AND (
    NOT EXISTS (SELECT FROM public.pricing_runs p WHERE p.id=target_run_id)
    OR NOT EXISTS (SELECT FROM public.companies c WHERE c.id=OLD.company_id)
  ) THEN
    RETURN OLD;
  END IF;

  -- A child DML already holds a relation or row write lock. Avoid waiting on
  -- a parent mutation which may itself be waiting for the child relation.
  SELECT p.status, p.company_id INTO source_status, parent_company_id
   FROM public.pricing_runs p
   WHERE p.id=target_run_id FOR SHARE NOWAIT;
  IF source_status='locked' OR EXISTS (
    SELECT FROM gridex_locked_pricing_evidence.run_seals seal
     WHERE seal.company_id=parent_company_id AND seal.run_id=target_run_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='locked_pricing_interval_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.gridex_protect_locked_pricing_evidence_v1() FROM PUBLIC;
CREATE TRIGGER gridex_pricing_interval_evidence_locked_guard_tg
BEFORE INSERT OR UPDATE OR DELETE ON public.pricing_interval_evidence
FOR EACH ROW EXECUTE FUNCTION public.gridex_protect_locked_pricing_evidence_v1();
END
$gridex_pricing_evidence_migration$;
RESET statement_timeout;
RESET lock_timeout;
