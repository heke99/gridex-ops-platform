-- Actual same-stack predecessor, captured immediately before 110500 applies.
-- This is a diagnostic receipt, never a migration or a fabricated ledger row.
SELECT jsonb_build_object(
 'format','gridex_utilts_pre_actor_catalog_v1',
 'codeSha',:'candidate_sha','codeTree',:'candidate_tree',
 'beforeMigrationVersion','20261001110500',
 'predecessorSignature','public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)',
 'oldPublic6Oid',p.oid,
 'sourceHash',encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'serverVersionNumber',current_setting('server_version_num'),
 'databaseIdentity',jsonb_build_object(
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
  'serverAddress',inet_server_addr()::text,'serverPort',inet_server_port(),
  'postmasterStartedAt',to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
FROM pg_proc p
WHERE p.oid=to_regprocedure('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb)');
