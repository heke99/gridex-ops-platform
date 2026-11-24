-- Apply the corresponding address owner and its migration receipt together.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_address_migration$
BEGIN
CREATE FUNCTION public.gridex_read_address_grid_snapshot_v1(p_address_keys text[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO public, pg_temp AS $$
  WITH chosen AS MATERIALIZED (
    SELECT address_key, latitude, longitude, sweref99_x, sweref99_y, confidence,
           provider, raw_payload, updated_at, expires_at
    FROM public.platform_address_lookup_cache
    WHERE address_key = ANY (p_address_keys)
      AND (expires_at IS NULL OR expires_at > statement_timestamp())
    ORDER BY updated_at DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'coordinates', jsonb_build_object('addressKey',a.address_key,'latitude',a.latitude,'longitude',a.longitude,
      'sweref99X',a.sweref99_x,'sweref99Y',a.sweref99_y,'confidence',a.confidence),
    'addressEvidence', jsonb_build_object('provider',a.provider,'updatedAt',a.updated_at,'expiresAt',a.expires_at),
    'polygon', to_jsonb(f),
    'opsGridOwnerId', o.ops_grid_owner_id,
    'geodata', to_jsonb(v))
  FROM chosen a
  LEFT JOIN LATERAL public.gridex_point_to_grid_area(a.sweref99_x,a.sweref99_y) f
    ON a.sweref99_x IS NOT NULL AND a.sweref99_y IS NOT NULL
  LEFT JOIN public.platform_grid_owners o ON o.id=f.grid_owner_id
  LEFT JOIN LATERAL (
    SELECT version_key,verified_at,completed_at,started_at
    FROM public.energy_geodata_versions
    WHERE provider='svk_arcgis' AND status='verified'
    ORDER BY verified_at DESC LIMIT 1
  ) v ON true
  WHERE coalesce(a.raw_payload->>'coordinate_scope','') <> 'postal_centroid'
    AND coalesce(a.provider,'') <> 'papilite_postal_centroid'
$$;
REVOKE ALL ON FUNCTION public.gridex_read_address_grid_snapshot_v1(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_address_grid_snapshot_v1(text[]) TO service_role;

CREATE SCHEMA gridex_partner_address_snapshot;
REVOKE ALL ON SCHEMA gridex_partner_address_snapshot FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_partner_address_snapshot.changes(
  source_xid xid8 PRIMARY KEY
);
CREATE TABLE gridex_partner_address_snapshot.entries(
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  address_keys text[] NOT NULL,
  captured_snapshot pg_snapshot NOT NULL,
  captured_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  engine_start timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(company_id,client_id,address_keys)
);
CREATE TABLE gridex_partner_address_snapshot.retention_fence(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  oldest_snapshot_xmin xid8 NOT NULL
);
INSERT INTO gridex_partner_address_snapshot.retention_fence(oldest_snapshot_xmin)
VALUES(pg_snapshot_xmin(pg_current_snapshot()));
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_partner_address_snapshot FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_partner_address_snapshot.record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  INSERT INTO gridex_partner_address_snapshot.changes VALUES(pg_current_xact_id()) ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION gridex_partner_address_snapshot.record_change() FROM PUBLIC;
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['platform_address_lookup_cache','platform_grid_area_geometries',
                                  'platform_grid_areas','platform_grid_owners','energy_geodata_versions']
  LOOP
    EXECUTE format('CREATE TRIGGER partner_address_snapshot_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I
      FOR EACH STATEMENT EXECUTE FUNCTION gridex_partner_address_snapshot.record_change()',relation);
  END LOOP;
END
$$;
CREATE FUNCTION public.gridex_reuse_partner_address_grid_snapshot_v2(
  p_company_id uuid,p_client_id uuid,p_address_keys text[],p_ttl_hours numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  captured pg_snapshot;
  result jsonb;
  retained_until timestamptz;
  exists_client boolean;
BEGIN
  IF p_company_id IS NULL OR p_client_id IS NULL
     OR p_address_keys IS NULL OR cardinality(p_address_keys) NOT BETWEEN 1 AND 8
     OR array_position(p_address_keys,NULL) IS NOT NULL
     OR EXISTS(SELECT FROM unnest(p_address_keys) k WHERE length(k) NOT BETWEEN 1 AND 512)
     OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 168
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='partner_address_snapshot_invalid_input'; END IF;

  SELECT EXISTS(SELECT FROM public.integration_api_clients c
                WHERE c.id=p_client_id AND c.company_id=p_company_id AND c.status='active'
                  AND c.deleted_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>statement_timestamp()))
  INTO exists_client;
  IF NOT exists_client THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='partner_address_snapshot_client_not_current';
  END IF;

  SELECT k.payload INTO result
  FROM gridex_partner_address_snapshot.entries k
  JOIN gridex_partner_address_snapshot.retention_fence f ON f.singleton
  WHERE k.company_id=p_company_id AND k.client_id=p_client_id AND k.address_keys=p_address_keys
    AND k.valid_until>statement_timestamp() AND k.engine_start=pg_postmaster_start_time()
    AND k.captured_at+make_interval(secs=>p_ttl_hours::double precision*3600)>statement_timestamp()
    AND pg_snapshot_xmin(k.captured_snapshot)>=f.oldest_snapshot_xmin
    AND NOT EXISTS(
      SELECT FROM gridex_partner_address_snapshot.changes d
      WHERE d.source_xid >= pg_snapshot_xmax(k.captured_snapshot)
    )
    AND NOT EXISTS(
      SELECT FROM pg_snapshot_xip(k.captured_snapshot) AS active(source_xid)
      JOIN gridex_partner_address_snapshot.changes d USING(source_xid)
    );
  IF FOUND THEN RETURN result; END IF;

  -- Both values are evaluated using the same statement snapshot. A later
  -- commit, including an older active XID, invalidates reuse on the next read.
  SELECT pg_current_snapshot(), public.gridex_read_address_grid_snapshot_v1(p_address_keys)
  INTO captured,result;
  IF result#>>'{coordinates,sweref99X}' IS NOT NULL AND result#>>'{coordinates,sweref99Y}' IS NOT NULL
     AND result#>>'{polygon,price_area}' IN ('SE1','SE2','SE3','SE4')
     AND nullif(result#>>'{polygon,grid_owner_name}','') IS NOT NULL
     AND result->>'opsGridOwnerId' IS NOT NULL
     AND result#>>'{geodata,version_key}' IS NOT NULL THEN
    retained_until:=least(
      statement_timestamp()+make_interval(secs=>p_ttl_hours::double precision*3600),
      (result#>>'{addressEvidence,expiresAt}')::timestamptz
    );
    INSERT INTO gridex_partner_address_snapshot.entries AS existing
      VALUES (p_company_id,p_client_id,p_address_keys,captured,statement_timestamp(),retained_until,pg_postmaster_start_time(),result)
    ON CONFLICT(company_id,client_id,address_keys) DO UPDATE
      SET captured_snapshot=excluded.captured_snapshot,captured_at=excluded.captured_at,valid_until=excluded.valid_until,
          engine_start=excluded.engine_start,payload=excluded.payload;
  END IF;
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.gridex_reuse_partner_address_grid_snapshot_v2(uuid,uuid,text[],numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_reuse_partner_address_grid_snapshot_v2(uuid,uuid,text[],numeric) TO service_role;

-- DDL proposal only. Scope and scheduler would require the actual source owner.
-- Publish the fence in the same transaction as all journal deletions.
CREATE FUNCTION gridex_partner_address_snapshot.evict_prior_generation()
RETURNS TABLE(expired_entries integer,pruned_changes integer)
LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE boundary xid8;
BEGIN
  UPDATE gridex_partner_address_snapshot.retention_fence
  SET oldest_snapshot_xmin=greatest(oldest_snapshot_xmin,pg_snapshot_xmax(pg_current_snapshot()))
  WHERE singleton RETURNING oldest_snapshot_xmin INTO boundary;

  DELETE FROM gridex_partner_address_snapshot.entries e
  WHERE e.ctid IN (
    SELECT p.ctid FROM gridex_partner_address_snapshot.entries p
    WHERE p.valid_until<=statement_timestamp() OR pg_snapshot_xmin(p.captured_snapshot)<boundary
    LIMIT 2048
  );
  GET DIAGNOSTICS expired_entries=ROW_COUNT;

  DELETE FROM gridex_partner_address_snapshot.changes c
  WHERE c.source_xid IN (
    SELECT p.source_xid FROM gridex_partner_address_snapshot.changes p
    WHERE p.source_xid<boundary ORDER BY p.source_xid LIMIT 2048
  );
  GET DIAGNOSTICS pruned_changes=ROW_COUNT;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION gridex_partner_address_snapshot.evict_prior_generation() FROM PUBLIC,anon,authenticated,service_role;
END
$gridex_address_migration$;
RESET statement_timeout;
RESET lock_timeout;
