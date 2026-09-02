-- GRIDEX-REM-002 replay-only compatibility shim.
-- 20260829194612 intentionally skips the white-label membership helper when
-- white_label_platform_memberships is absent from canonical clean replay.
-- 20260902100500 nevertheless performs privilege hygiene on that helper.
-- Create a fail-closed helper only for the duration of that migration; the
-- replay driver removes it immediately afterwards when it created the shim.

create or replace function public.gridex_user_has_white_label_admin_membership(
  p_white_label_platform_id uuid
)
returns boolean
language sql
stable
set search_path = public, auth, pg_temp
as $function$
  select false;
$function$;
