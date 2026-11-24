-- Keep implementation and the Supabase migration receipt atomic.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $ediel_aperak_migration$
BEGIN

-- Extend the current private journal without replacing the surrounding owner chain.
DO $migration$
DECLARE
  journal_oid regprocedure := 'gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)'::regprocedure;
  journal_hash constant text := 'ecf31dbcb58e2c437a5286d781cffa052d49ab5f91f48521596ee93d6737d141';
  replay_oid regprocedure := 'gridex_ediel_transport.mutate_before_original_basis_v1(jsonb)'::regprocedure;
  replay_hash constant text := '87b7f6f46aa4af6645a56deed6c10aa27de438763c6ff114801ff66bf09d2c5e';
  source_definition text;
  updated_definition text;
  old_prepare constant text := $prepare$   return jsonb_build_object('proceed',false,'state',r.state,'classification',a.classification,'providerReceipt',case when a.classification='accepted' then a.provider_result else null end,'observedAt',a.observed_at);
  end if;
  if owner->>'kind'='worker' then$prepare$;
  new_prepare constant text := $prepare$   if not cancelled_aperak or r.state<>'prepared' or a.entered_at is not null then
    return jsonb_build_object('proceed',false,'state',r.state,'classification',a.classification,'providerReceipt',case when a.classification='accepted' then a.provider_result else null end,'observedAt',a.observed_at);
   end if;
  end if;
  if cancelled_aperak then raise exception 'ediel_transport_aperak_cancelled' using errcode='GX104'; end if;
  if owner->>'kind'='worker' then$prepare$;
  old_enter constant text := $entry$  if r.state<>'prepared' then return jsonb_build_object('proceed',false,'state',r.state); end if;$entry$;
  new_enter constant text := $entry$  if r.state<>'prepared' then return jsonb_build_object('proceed',false,'state',r.state); end if;
  if cancelled_aperak and a.entered_at is null then raise exception 'ediel_transport_aperak_cancelled' using errcode='GX104'; end if;$entry$;
  old_replay constant text := $replay$   IF retry IS NULL OR retry='null'::jsonb OR r.state<>'observed' OR a.classification NOT IN('pre_connect_negative','explicit_negative','all_rejected') THEN$replay$;
  new_replay constant text := $replay$   IF m.message_family='APERAK' AND m.status='cancelled' AND r.state='prepared' AND a.entered_at IS NULL THEN
    RAISE EXCEPTION 'ediel_transport_aperak_cancelled' USING ERRCODE='GX104';
   END IF;
   IF retry IS NULL OR retry='null'::jsonb OR r.state<>'observed' OR a.classification NOT IN('pre_connect_negative','explicit_negative','all_rejected') THEN$replay$;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=journal_oid) IS DISTINCT FROM journal_hash THEN
    RAISE EXCEPTION 'ediel_cancelled_aperak_transport_unexpected_journal';
  END IF;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=replay_oid) IS DISTINCT FROM replay_hash THEN
    RAISE EXCEPTION 'ediel_cancelled_aperak_transport_unexpected_replay';
  END IF;

  source_definition := pg_get_functiondef(journal_oid);
  IF strpos(source_definition, 'technical_candidate boolean:=false;')=0
     OR strpos(source_definition, E' is_ai:=m.message_standard=')=0
     OR strpos(source_definition, old_prepare)=0
     OR strpos(source_definition, old_enter)=0 THEN
    RAISE EXCEPTION 'ediel_cancelled_aperak_transport_missing_anchor';
  END IF;

  updated_definition := replace(source_definition, 'technical_candidate boolean:=false;',
    'technical_candidate boolean:=false; cancelled_aperak boolean;');
  updated_definition := replace(updated_definition, E' is_ai:=m.message_standard=',
    E' cancelled_aperak:=m.message_family is not distinct from ''APERAK'' and m.status is not distinct from ''cancelled'';\n is_ai:=m.message_standard=');
  updated_definition := replace(updated_definition, old_prepare, new_prepare);
  updated_definition := replace(updated_definition, old_enter, new_enter);
  EXECUTE updated_definition;

  -- The historical replay wrapper returns before the inner journal when an
  -- existing reservation has not been released. Only prepared can be cancelled.
  source_definition := pg_get_functiondef(replay_oid);
  IF strpos(source_definition, old_replay)=0 THEN
    RAISE EXCEPTION 'ediel_cancelled_aperak_transport_missing_replay_anchor';
  END IF;
  EXECUTE replace(source_definition, old_replay, new_replay);
END;
$migration$;

END
$ediel_aperak_migration$;
RESET statement_timeout;
RESET lock_timeout;
