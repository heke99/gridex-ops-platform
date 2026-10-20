-- FINDINGS F59 (owner decision 2026-10-20): a manual customer intake with an
-- already signed, uploaded agreement is imported by
-- gridex_finalize_admin_imported_signed_agreement_v1 only for an actor holding
-- contracts.create (owner decision 2026-10-11). Only pricing_manager and
-- super_admin held it, and pricing_manager cannot write customers, so no
-- tenant employee could ever register a paper-signed customer. The tenant's
-- administrators and customer-service managers now hold contracts.create.
-- The database check itself is unchanged; publishing stays with the catalog
-- publish rights (contracts.publish, pricing.publish).
begin;

insert into public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
select r.id,r.key,p.id,p.key,'allow'
from public.roles r
join public.permissions p on p.key='contracts.create'
where r.key in ('company_admin','owner','customer_service_manager')
  and not exists (
    select 1 from public.role_permissions rp
    where (rp.role_id=r.id or lower(coalesce(rp.role_key,''))=lower(r.key))
      and (rp.permission_id=p.id or rp.permission_key=p.key)
      and coalesce(rp.effect,'allow')='allow'
  );

commit;
