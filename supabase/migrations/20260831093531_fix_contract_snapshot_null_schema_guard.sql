-- Fail open to non-v6 snapshot formats and keep v6 commercial identity checks strict.
--
-- PostgreSQL three-valued logic makes `NULL <> 'value'` evaluate to NULL.
-- In a PL/pgSQL IF that does not enter the return branch, which previously
-- caused legacy/admin contract price snapshots without a schema identity to
-- fall through into the v6 commercial-selection validation.

create or replace function public.gridex_bind_contract_snapshot_to_quote_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_snapshot jsonb:=coalesce(new.snapshot_json,'{}'::jsonb);
  v_quote public.website_contract_quotes%rowtype;
  v_requires_quote boolean;
begin
  new.snapshot_schema_version:=coalesce(
    new.snapshot_schema_version,
    v_snapshot->>'snapshot_schema',
    v_snapshot->>'schema_version'
  );

  if new.snapshot_schema_version is distinct from 'gridex_contract_pricing_v6_selection' then
    return new;
  end if;

  new.quote_reference:=coalesce(
    new.quote_reference,v_snapshot->>'quote_reference'
  );
  new.quote_hash:=coalesce(new.quote_hash,v_snapshot->>'quote_hash');
  new.price_option_reference:=coalesce(
    new.price_option_reference,v_snapshot->>'price_option_reference'
  );
  new.area_price_reference:=coalesce(
    new.area_price_reference,v_snapshot->>'area_price_reference'
  );
  new.invoice_delivery_method:=coalesce(
    new.invoice_delivery_method,v_snapshot->>'invoice_delivery_method'
  );
  if new.selected_component_references='{}'::text[] then
    new.selected_component_references:=array(
      select value
      from jsonb_array_elements_text(
        coalesce(v_snapshot->'selected_component_references','[]'::jsonb)
      )
    );
  end if;
  v_requires_quote:=coalesce(new.source,'') in (
    'website_customer_applications',
    'external_website',
    'website_application'
  );
  if (v_requires_quote and new.quote_reference is null)
    or (v_requires_quote and new.quote_hash is null)
    or new.price_option_reference is null
    or new.invoice_delivery_method is null
    or (
      v_snapshot->>'contract_type'='fixed'
      and new.area_price_reference is null
    )
    or jsonb_typeof(new.base_price_components_snapshot)<>'array'
    or jsonb_typeof(new.price_components_snapshot)<>'array' then
    raise exception using
      errcode='23514',
      message='contract_commercial_snapshot_identity_incomplete';
  end if;

  if v_requires_quote then
    select quote.*
      into v_quote
    from public.website_contract_quotes quote
    where quote.company_id=new.company_id
      and quote.quote_reference=new.quote_reference;
    if not found
      or v_quote.quote_hash is distinct from new.quote_hash
      or v_quote.price_option_reference
        is distinct from new.price_option_reference
      or v_quote.area_price_reference is distinct from new.area_price_reference
      or v_quote.invoice_delivery_method
        is distinct from new.invoice_delivery_method
      or v_quote.selected_component_references
        is distinct from new.selected_component_references
      or v_quote.resolved_base_components
        is distinct from new.base_price_components_snapshot
      or v_quote.resolved_price_components
        is distinct from new.price_components_snapshot then
      raise exception using
        errcode='23514',
        message='contract_snapshot_quote_selection_mismatch';
    end if;
  end if;
  return new;
end
$function$;
