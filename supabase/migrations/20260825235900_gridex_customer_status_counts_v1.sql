create or replace function public.gridex_customer_status_counts_v1(
  p_company_id uuid default null,
  p_customer_type text default 'all',
  p_exclude_test_data boolean default false
)
returns table (
  all_count bigint,
  draft bigint,
  pending_verification bigint,
  active bigint,
  inactive bigint,
  moved bigint,
  terminated bigint,
  blocked bigint,
  archived bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (
      where c.status is null
         or c.status not in ('archived', 'deleted', 'deleted_test_only', 'pending_deletion')
    ) as all_count,
    count(*) filter (where c.status = 'draft') as draft,
    count(*) filter (where c.status = 'pending_verification') as pending_verification,
    count(*) filter (where c.status = 'active') as active,
    count(*) filter (where c.status = 'inactive') as inactive,
    count(*) filter (where c.status = 'moved') as moved,
    count(*) filter (where c.status = 'terminated') as terminated,
    count(*) filter (where c.status = 'blocked') as blocked,
    count(*) filter (where c.status = 'archived') as archived
  from public.customers c
  where c.company_id is not null
    and (p_company_id is null or c.company_id = p_company_id)
    and (c.source is null or c.source <> 'ediel_portal_test')
    and (
      coalesce(p_customer_type, 'all') = 'all'
      or (
        p_customer_type = 'private'
        and (c.customer_type is null or c.customer_type = 'private')
      )
      or (
        p_customer_type in ('business', 'association')
        and c.customer_type = p_customer_type
      )
    )
    and (
      not coalesce(p_exclude_test_data, false)
      or (
        (c.is_test_data is null or c.is_test_data = false)
        and (c.source is null or c.source not ilike '%test%')
      )
    );
$$;

revoke all on function public.gridex_customer_status_counts_v1(uuid, text, boolean) from public;
revoke all on function public.gridex_customer_status_counts_v1(uuid, text, boolean) from anon;
revoke all on function public.gridex_customer_status_counts_v1(uuid, text, boolean) from authenticated;
grant execute on function public.gridex_customer_status_counts_v1(uuid, text, boolean) to service_role;

comment on function public.gridex_customer_status_counts_v1(uuid, text, boolean) is
  'Service-role aggregate for OPS customer status chips; preserves tenant/test/customer-type filters while collapsing nine count round-trips into one scan.';
