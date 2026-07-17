-- Versioned website-card visibility for pricing components.
-- Visibility is presentation metadata only; pricing, checkout, contracts and invoices retain every component.

begin;

alter table public.price_components
  add column if not exists website_card_visible boolean not null default true;

comment on column public.price_components.website_card_visible is
  'Whether this immutable price component may be rendered on the tenant website contract card. Does not affect quote, checkout, contract document or invoice calculation.';

create or replace function public.gridex_sync_price_component_visibility()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_metadata_visible boolean;
begin
  if jsonb_typeof(coalesce(new.metadata, '{}'::jsonb)->'visibility') = 'object'
     and (coalesce(new.metadata, '{}'::jsonb)->'visibility') ? 'website_card' then
    v_metadata_visible := (new.metadata#>>'{visibility,website_card}')::boolean;
    new.website_card_visible := v_metadata_visible;
  end if;

  new.metadata := jsonb_set(
    coalesce(new.metadata, '{}'::jsonb),
    '{visibility}',
    coalesce(coalesce(new.metadata, '{}'::jsonb)->'visibility', '{}'::jsonb)
      || jsonb_build_object(
        'website_card', new.website_card_visible,
        'quote_breakdown', true,
        'checkout', true,
        'contract_document', true,
        'invoice', new.invoice_line_visible
      ),
    true
  );
  return new;
end
$$;

-- Existing rows retain their historic visible behavior. New immutable versions
-- carry explicit visibility in snapshot_json and component metadata.
drop trigger if exists price_components_sync_website_visibility on public.price_components;
create trigger price_components_sync_website_visibility
before insert or update of metadata, website_card_visible, invoice_line_visible
on public.price_components
for each row execute function public.gridex_sync_price_component_visibility();

-- Runtime assertion: migration must leave the canonical column and trigger present.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'price_components'
      and column_name = 'website_card_visible'
      and data_type = 'boolean'
      and is_nullable = 'NO'
  ) then
    raise exception 'price_components.website_card_visible_missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.price_components'::regclass
      and tgname = 'price_components_sync_website_visibility'
      and not tgisinternal
  ) then
    raise exception 'price_components_visibility_trigger_missing';
  end if;
end
$$;

commit;
