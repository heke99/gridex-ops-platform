-- Use the exact, independently verified Z05/L cutoff in both portal readers.
-- An unproved end and a separately recorded actual day retain their old ceilings.
DO $replace_source_ends$
DECLARE
  verified_end_oid regprocedure := 'public.gridex_portal_verified_supply_ends_v1(uuid,uuid,uuid[])'::regprocedure;
  windows_oid regprocedure := 'gridex_private.portal_consumption_supply_windows_v1(uuid,uuid[])'::regprocedure;
  definition text;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = verified_end_oid)
      IS DISTINCT FROM 'f0330cfd5a9a2db2c14b6cfe5c7c0be9128033a496263870abdf4612db1540fd' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'portal_supply_cutoff_preimage_changed';
  END IF;
  SELECT pg_get_functiondef(verified_end_oid) INTO STRICT definition;
  definition := replace(definition, $old_0$      AND p.status = 'ended'
$old_0$,
    $new_0$      AND p.status IN ('ending', 'ended')
$new_0$);
  definition := replace(definition, $old_1$      AND p.market_end_at <= statement_timestamp()
$old_1$,
    $new_1$      AND (
        (p.status = 'ended' AND p.market_end_at <= statement_timestamp())
        OR (p.status = 'ending' AND isfinite(p.end_date)
          AND p.market_end_at > (p.end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm')
      )
$new_1$);
  EXECUTE definition;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = verified_end_oid)
      IS DISTINCT FROM 'ed36aff79a44f2d14f8a728e37c06e1c400c128ed22056453e208be2dee1bf98' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'portal_supply_cutoff_postimage_changed';
  END IF;

  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = windows_oid)
      IS DISTINCT FROM '1941cf988a5da7b5c143f2756c0d2692a02e3de4b832d2383178931f6a9b26f5' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'portal_supply_cutoff_preimage_changed';
  END IF;
  SELECT pg_get_functiondef(windows_oid) INTO STRICT definition;
  definition := replace(definition, $old_0$terminal_periods$old_0$,
    $new_0$source_end_periods$new_0$);
  definition := replace(definition, $old_1$terminal_batches$old_1$,
    $new_1$source_end_batches$new_1$);
  definition := replace(definition, $old_2$    WHERE p.status = 'ended' AND p.actual_end_date IS NULL
$old_2$,
    $new_2$    WHERE p.actual_end_date IS NULL
      AND (p.status = 'ended' OR (p.status = 'ending' AND isfinite(p.end_date)
        AND isfinite(p.market_end_at)
        AND p.market_end_at > (p.end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'))
$new_2$);
  definition := replace(definition, $old_3$      coalesce((p.end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm', 'infinity'::timestamptz),
$old_3$,
    $new_3$      CASE WHEN e.period_id IS NULL THEN
        coalesce((p.end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm', 'infinity'::timestamptz)
      ELSE 'infinity'::timestamptz END,
$new_3$);
  EXECUTE definition;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = windows_oid)
      IS DISTINCT FROM '9d43e7fa7ef906ead6e6f8ea23a76d109230da90cc481837cb89f60f8931ce21' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'portal_supply_cutoff_postimage_changed';
  END IF;

END
$replace_source_ends$;
