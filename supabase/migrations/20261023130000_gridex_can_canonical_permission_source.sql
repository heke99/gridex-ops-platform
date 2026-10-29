-- gridex_can: converge the repository on the production definition.
--
-- 20260523_db3_tenant_isolation_rbac_enforcement made gridex_can delegate to
-- gridex_has_permission, which only answers for an active, unbanned, confirmed
-- account with an active profile and reads the canonical
-- gridex_get_user_permissions source. Production runs that body. The clean
-- replay still ended on the older db1 body, which reads the legacy
-- user_permission_overrides/user_permissions/role_permissions tables directly
-- and skips every account-status check.
--
-- The body below is byte-identical to production (prosrc sha256 e77c677e…),
-- so applying it in production is a no-op. Attributes and grants are unchanged.

CREATE OR REPLACE FUNCTION public.gridex_can(p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
begin
  if p_permission is null or auth.uid() is null then
    return false;
  end if;

  if public.gridex_user_is_platform_admin() then
    return true;
  end if;

  return public.gridex_has_permission(auth.uid(), p_permission);
exception when others then
  return false;
end;
$function$;
