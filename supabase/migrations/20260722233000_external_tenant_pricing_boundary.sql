-- API 2026-07-22.2: separate OPS canonical contract data from tenant-managed
-- public market-price previews and energy-area resolution.
begin;

-- External website keys no longer receive OPS quote or public area resolver
-- scopes. Existing grants are removed without touching unrelated permissions.
update public.integration_api_clients c
set scopes = array(
      select scope
      from unnest(coalesce(c.scopes, '{}'::text[])) scope
      where scope not in (
        'website_quotes.write',
        'website_quotes.validate',
        'website_energy_area.resolve'
      )
      order by scope
    ),
    updated_at = now()
where coalesce(c.scopes, '{}'::text[]) && array[
  'website_quotes.write',
  'website_quotes.validate',
  'website_energy_area.resolve'
]::text[];

update public.integration_api_permission_groups
set recommended_default = false,
    is_active = false,
    description = case group_key
      when 'website_quotes' then
        'Borttagen i API 2026-07-22.2. Tenantens backend hämtar avtalskomponenter från public-contracts och beräknar själv indikativa marknadspriser.'
      when 'website_energy_area' then
        'Borttagen i API 2026-07-22.2. Tenantens publika webbplats löser prisområdet själv; OPS verifierar området vid kundansökan och operativ onboarding.'
      else description
    end,
    updated_at = now()
where group_key in ('website_quotes', 'website_energy_area');

comment on table public.website_contract_quotes is
  'Legacy historical quote records. New external website integrations must not create OPS market-price quotes after API 2026-07-22.2.';

-- Persist the calculation/presentation separation for all future normalized
-- components. Existing immutable rows receive safe defaults through ADD COLUMN
-- and are projected with their historic website_card_visible value by the API.
alter table public.price_components
  add column if not exists calculation_inclusion text not null default 'included',
  add column if not exists website_summary_visible boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.price_components'::regclass
      and conname = 'price_components_calculation_inclusion_check'
  ) then
    alter table public.price_components
      add constraint price_components_calculation_inclusion_check
      check (calculation_inclusion in ('included', 'excluded', 'conditional'));
  end if;
end $$;

comment on column public.price_components.calculation_inclusion is
  'Controls whether the component participates in tenant calculations. Independent of website presentation visibility.';
comment on column public.price_components.website_summary_visible is
  'Controls whether the component may appear in a detailed customer price summary. website_card_visible only controls the sales card.';
comment on column public.price_components.website_card_visible is
  'Presentation-only flag. Hidden components remain in the external calculation contract and in billing.';

commit;
