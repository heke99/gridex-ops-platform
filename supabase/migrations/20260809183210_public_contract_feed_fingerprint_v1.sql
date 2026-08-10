begin;
set local search_path=public,pg_catalog;
create or replace function public.public_contract_feed_fingerprint_v1(p_company_id uuid,p_customer_type text default null,p_channel text default 'website')
returns table(fingerprint text,publication_revision bigint,publication_updated_at timestamptz,stockholm_date date)
language sql stable security invoker set search_path=public,pg_catalog as $$
with context as (
 select coalesce(r.revision,0)::bigint as publication_revision,r.updated_at as publication_updated_at,(current_timestamp at time zone 'Europe/Stockholm')::date as stockholm_date,coalesce(r.revision_token::text,'initial') as revision_token
 from (select 1)x left join public.contract_publication_revisions r on r.company_id=p_company_id and r.channel=p_channel
), visible as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(v) order by v.sort_order,v.public_name,v.id)::text,'[]')),md5('[]')) as h from public.canonical_visible_public_contracts_v v where v.company_id=p_company_id and v.is_archived=false and (p_customer_type is null or v.customer_type='both' or v.customer_type=p_customer_type)
), delivery as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(d) order by d.offer_reference,d.public_offer_id)::text,'[]')),md5('[]')) as h from public.canonical_public_contract_delivery_readiness_v d where d.company_id=p_company_id and d.channel=p_channel and (p_customer_type is null or d.customer_type='both' or d.customer_type=p_customer_type)
), publication_readiness as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(r) order by r.contract_publication_version_id)::text,'[]')),md5('[]')) as h from public.contract_publication_readiness_v r where r.company_id=p_company_id
), options as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(o) order by o.sort_order,o.option_reference,o.id)::text,'[]')),md5('[]')) as h from public.contract_price_options o where o.company_id=p_company_id
), area_prices as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(a) order by a.contract_price_option_id,a.price_area,a.id)::text,'[]')),md5('[]')) as h from public.contract_price_option_area_prices a where a.company_id=p_company_id
), legal_bundles as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text,'[]')),md5('[]')) as h from public.legal_bundle_versions b where b.company_id=p_company_id
), legal_documents as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(d) order by d.legal_bundle_version_id,d.sort_order,d.id)::text,'[]')),md5('[]')) as h from public.legal_bundle_version_documents d join public.legal_bundle_versions b on b.id=d.legal_bundle_version_id where b.company_id=p_company_id
), portfolio as (
 select coalesce(md5(coalesce(jsonb_agg(to_jsonb(s) order by s.delivery_month desc,s.price_area_code,s.id)::text,'[]')),md5('[]')) as h from public.portfolio_monthly_settlements s where s.company_id=p_company_id and s.is_current=true and s.status in ('final','locked')
), tenant as (
 select coalesce(md5(coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'company_slug',c.company_slug,'org_number',c.org_number,'status',c.status,'branding',c.branding,'metadata',c.metadata,'external_tenant_reference',c.external_tenant_reference,'updated_at',c.updated_at) order by c.id)::text,'[]')),md5('[]')) as h from public.companies c where c.id=p_company_id
)
select md5(concat_ws(':',p_company_id::text,p_channel,coalesce(p_customer_type,'all'),ctx.stockholm_date::text,ctx.publication_revision::text,ctx.revision_token,v.h,d.h,pr.h,o.h,a.h,lb.h,ld.h,p.h,t.h)) as fingerprint,ctx.publication_revision,ctx.publication_updated_at,ctx.stockholm_date
from context ctx cross join visible v cross join delivery d cross join publication_readiness pr cross join options o cross join area_prices a cross join legal_bundles lb cross join legal_documents ld cross join portfolio p cross join tenant t;
$$;
revoke all on function public.public_contract_feed_fingerprint_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.public_contract_feed_fingerprint_v1(uuid,text,text) to service_role;
commit;
