-- Residual advisor hygiene.
--
-- Neither finding is exploitable: gridex_point_to_grid_area is not SECURITY
-- DEFINER and no client role can execute it, and
-- gridex_user_has_white_label_admin_membership derives from auth.uid(), so an
-- anonymous caller only ever gets false.
--
-- Both are closed anyway, so the advisor stays quiet and a future change to
-- either function does not inherit a loose default.
--
-- Forward-only.

begin;

alter function public.gridex_point_to_grid_area(numeric, numeric)
  set search_path = 'public', 'extensions', 'pg_temp';

revoke execute on function public.gridex_user_has_white_label_admin_membership(uuid) from anon, public;
grant execute on function public.gridex_user_has_white_label_admin_membership(uuid) to authenticated;

commit;
