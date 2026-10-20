-- FINDINGS F62 (owner decision 2026-10-20): the supplier-switch worker
-- authorizes the job's acting employee with communication.write and
-- operations.write, and the Ediel prepare/inbound steps require
-- communication.write. In production communication.write was held by no role
-- and operations.write did not exist in the permission catalog (only native
-- test fixtures created it; gridex_actor_has_company_permission requires an
-- active catalog key), so no automatic supplier switch could ever start for
-- any tenant. operations.write joins the catalog, and the tenant roles that
-- already run switching and metering hold both rights. Application checks,
-- communication.send and ediel.send are unchanged.
begin;

insert into public.permissions(key,name,description,category,is_active)
select 'operations.write','Driva kundoperationer',
  'Kan låta kundoperationer och automatiska jobb (t.ex. start av leverantörsbyte) utföras för bolaget.',
  'Operations',true
where not exists (select 1 from public.permissions where key='operations.write');

insert into public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
select r.id,r.key,p.id,p.key,'allow'
from public.roles r
join public.permissions p on p.key in ('communication.write','operations.write')
where r.key in ('company_admin','owner','operations_manager','customer_service_manager')
  and not exists (
    select 1 from public.role_permissions rp
    where (rp.role_id=r.id or lower(coalesce(rp.role_key,''))=lower(r.key))
      and (rp.permission_id=p.id or rp.permission_key=p.key)
      and coalesce(rp.effect,'allow')='allow'
  );

commit;
