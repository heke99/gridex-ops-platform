-- Resolve portal customer candidates in one tenant-bound roundtrip using the
-- same normalized factors as the existing sync route. The function returns
-- candidates + match flags only; authorization remains the explicit strong/
-- weak/manual policy in the application layer.

begin;
set local search_path = public, pg_catalog;

create or replace function public.resolve_portal_customer_identity_v1(
  p_company_id uuid,
  p_email text default null,
  p_customer_number text default null,
  p_identifier text default null,
  p_facility_id text default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  company_id uuid,
  customer_number text,
  email text,
  personal_number text,
  org_number text,
  email_matched boolean,
  customer_number_matched boolean,
  identifier_matched boolean,
  facility_matched boolean,
  matched_factor_count integer
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with candidate_rows as (
    select
      c.id,
      c.company_id,
      c.customer_number,
      c.email,
      c.personal_number,
      c.org_number,
      (
        nullif(lower(btrim(coalesce(p_email,''))),'') is not null
        and lower(btrim(coalesce(c.email,''))) = lower(btrim(p_email))
      ) as email_matched,
      (
        nullif(btrim(coalesce(p_customer_number,'')),'') is not null
        and c.customer_number = btrim(p_customer_number)
      ) as customer_number_matched,
      (
        nullif(btrim(coalesce(p_identifier,'')),'') is not null
        and (
          c.normalized_personal_number = btrim(p_identifier)
          or c.normalized_org_number = btrim(p_identifier)
          or regexp_replace(coalesce(c.personal_number,''),'[^0-9]','','g') = btrim(p_identifier)
          or regexp_replace(coalesce(c.org_number,''),'[^0-9]','','g') = btrim(p_identifier)
        )
      ) as identifier_matched,
      (
        nullif(btrim(coalesce(p_facility_id,'')),'') is not null
        and exists (
          select 1
          from public.customer_sites s
          where s.company_id = p_company_id
            and s.customer_id = c.id
            and (
              s.normalized_facility_id = btrim(p_facility_id)
              or s.facility_id = btrim(p_facility_id)
            )
        )
      ) as facility_matched,
      c.created_at
    from public.customers c
    where c.company_id = p_company_id
  ), scored as (
    select
      r.*,
      (r.email_matched::integer + r.customer_number_matched::integer +
       r.identifier_matched::integer + r.facility_matched::integer) as factor_count
    from candidate_rows r
  )
  select
    s.id,
    s.company_id,
    s.customer_number,
    s.email,
    s.personal_number,
    s.org_number,
    s.email_matched,
    s.customer_number_matched,
    s.identifier_matched,
    s.facility_matched,
    s.factor_count
  from scored s
  where s.factor_count > 0
  order by s.factor_count desc, s.created_at desc, s.id desc
  limit greatest(1, least(coalesce(p_limit,20),100));
$$;

revoke all on function public.resolve_portal_customer_identity_v1(
  uuid,text,text,text,text,integer
) from public, anon, authenticated;
grant execute on function public.resolve_portal_customer_identity_v1(
  uuid,text,text,text,text,integer
) to service_role;

commit;
