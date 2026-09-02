\set ON_ERROR_STOP on

DO $$
DECLARE
  v_missing bigint;
  v_bad_alias bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.powers_of_attorney p
  WHERE lower(coalesce(p.status, '')) = 'signed'
    AND lower(coalesce(p.source, '')) = 'website_api'
    AND jsonb_typeof(p.signed_scope_snapshot) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(p.signed_scope_snapshot) x(scope_type)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.power_of_attorney_scopes s
        WHERE s.company_id = p.company_id
          AND s.power_of_attorney_id = p.id
          AND s.scope_type = x.scope_type
          AND coalesce(s.is_active, true) = true
      )
    );
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'signed website POAs missing relational scopes: %', v_missing;
  END IF;

  SELECT count(*) INTO v_bad_alias
  FROM public.platform_grid_areas ga
  JOIN public.platform_grid_owners pgo ON pgo.id = ga.grid_owner_id
  WHERE coalesce(ga.is_active, true) = true
    AND nullif(btrim(pgo.ediel_id), '') IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.platform_grid_owners canonical
      WHERE canonical.id <> pgo.id
        AND coalesce(canonical.is_active, true) = true
        AND public.gridex_grid_owner_name_key(canonical.name) = public.gridex_grid_owner_name_key(pgo.name)
        AND nullif(btrim(canonical.ediel_id), '') IS NOT NULL
        AND canonical.ops_grid_owner_id IS NOT NULL
    );
  IF v_bad_alias <> 0 THEN
    RAISE EXCEPTION 'grid areas still bound to non-canonical owner aliases: %', v_bad_alias;
  END IF;
END $$;

SELECT 'arbel_poa_grid_owner_fix_ok' AS status;
