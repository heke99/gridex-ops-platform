DO $migration$
BEGIN

-- The same legacy API ran on both sides of a rolling deploy. Its insertion
-- trigger cannot establish which producer prepared an item.
DROP TRIGGER gridex_capway_dispatch_new_item ON public.invoice_export_items;
DROP FUNCTION gridex_capway_dispatch.mark_new_item_v1();

-- Preserve old observations and entries for reconciliation. NULL identifies
-- the implicit legacy marker, which cannot grant a new transport entry.
ALTER TABLE gridex_capway_dispatch.new_items
  ADD COLUMN producer_version smallint,
  ADD COLUMN invoice_id uuid,
  ADD CONSTRAINT capway_dispatch_explicit_producer_evidence CHECK (
    (producer_version IS NULL AND invoice_id IS NULL)
    OR (producer_version IS NOT NULL AND producer_version=1 AND invoice_id IS NOT NULL)
  );

DO $patch$
DECLARE
  prior record;
  revision text;
  old_condition constant text := $condition$      AND n.run_id=item.export_run_id AND n.underlay_id=underlay.id AND n.pricing_run_id=pricing.id$condition$;
  new_condition constant text := $condition$      AND n.run_id=item.export_run_id AND n.underlay_id=underlay.id AND n.pricing_run_id=pricing.id
      AND n.producer_version=1 AND n.invoice_id=invoice.id$condition$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata
    INTO STRICT prior FROM pg_proc proc
    WHERE oid=to_regprocedure('public.gridex_reserve_capway_dispatch_entry_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text)');
  IF encode(sha256(convert_to(prior.prosrc,'UTF8')),'hex') <> '61351a6837b020af13aa36251acb589ebe5ac80acd047835c7ef07ac6f31f4fa' THEN
    RAISE EXCEPTION 'capway_dispatch_producer_predecessor_changed';
  END IF;

  revision:=replace(prior.prosrc,old_condition,new_condition);
  EXECUTE replace(prior.definition,prior.prosrc,revision);
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=prior.oid) IS DISTINCT FROM prior.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=prior.oid)
      <> '6412794ef7f691c072dd5a2d5af5be25c7221cceed8d6686de5df1c0e07e9693' THEN
    RAISE EXCEPTION 'capway_dispatch_producer_reservation_changed';
  END IF;
END
$patch$;

END
$migration$;
