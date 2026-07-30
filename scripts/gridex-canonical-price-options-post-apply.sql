\set ON_ERROR_STOP on

-- Read-only production verification after
-- 20260730220000_canonical_price_option_publication_api_completion.sql.

select jsonb_build_object(
  'unbound_active_options', (
    select count(*)
    from public.contract_price_options
    where status='active'
      and contract_publication_version_id is null
  ),
  'published_versions_without_options', (
    select count(*)
    from public.contract_publication_versions publication
    join public.contract_publications publication_root
      on publication_root.id=publication.contract_publication_id
    where publication.status='published'
      and publication_root.channel in ('website','api')
      and not exists(
        select 1
        from public.contract_price_options option_row
        where option_row.contract_publication_version_id=publication.id
          and option_row.status='active'
      )
  ),
  'published_versions_with_invalid_default_count', (
    select count(*)
    from (
      select publication.id
      from public.contract_publication_versions publication
      join public.contract_publications publication_root
        on publication_root.id=publication.contract_publication_id
      left join public.contract_price_options option_row
        on option_row.contract_publication_version_id=publication.id
       and option_row.status='active'
      where publication.status='published'
        and publication_root.channel in ('website','api')
      group by publication.id
      having count(*) filter(where option_row.is_default is true)<>1
    ) invalid_defaults
  ),
  'open_price_option_reviews', (
    select count(*)
    from public.contract_pricing_migration_reviews
    where status='open'
      and reason_code like 'price_option_%'
  ),
  'v3_quotes_without_complete_selection', (
    select count(*)
    from public.website_contract_quotes
    where quote_hash_version='v3_commercial_selection'
      and (
        price_option_reference is null
        or invoice_delivery_method is null
        or site_count<1
      )
  ),
  'canonical_onboard_function', (
    select to_regprocedure(
      'public.gridex_onboard_customer_graph(jsonb)'
    ) is not null
  )
) as canonical_price_option_post_apply;

select
  review.company_id,
  review.price_plan_version_id,
  review.source_id,
  review.reason_code,
  review.details,
  review.created_at
from public.contract_pricing_migration_reviews review
where review.status='open'
  and review.reason_code like 'price_option_%'
order by review.created_at,review.company_id,review.source_id;
