"""Full non-system domain snapshots for the owned native timestamp target.

The immutable repair projection is extended, never weakened or rewritten.
The canonical ledger is deliberately separate: Runner verifies every real row.
"""
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
CATALOG_SHA = '1d6315ea6d4d542a01e4b697f1cc2b4528a227f2be7e7052f47c8a04166103c7'
NAMESPACE = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'"
EXTRA = """
 UNION ALL
 SELECT 'schema/'||n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
 'acl',n.nspacl,'comment',obj_description(n.oid,'pg_namespace'))
 FROM pg_namespace n WHERE {namespace}
 UNION ALL
 SELECT 'domain_constraint/'||n.nspname||'.'||t.typname||'/'||c.conname,
 jsonb_build_object('definition',pg_get_constraintdef(c.oid,false),'validated',c.convalidated)
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 JOIN pg_constraint c ON c.contypid=t.oid WHERE {namespace}
"""
ROWS = """
CREATE TEMP TABLE native_timestamp_rows(k text PRIMARY KEY,n bigint,h text) ON COMMIT DROP;
DO $snapshot$
DECLARE r record; amount bigint; fingerprint text;
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE {namespace} AND c.relkind IN ('r','p')
 AND NOT (n.nspname='supabase_migrations' AND c.relname='schema_migrations') ORDER BY 1,2
 LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'''')) FROM %I.%I t',r.nspname,r.relname)
   INTO amount,fingerprint;
  INSERT INTO pg_temp.native_timestamp_rows VALUES(r.nspname||'.'||r.relname,amount,fingerprint);
 END LOOP;
END $snapshot$;
SELECT coalesce(jsonb_object_agg(k,jsonb_build_array(n,h)),'{}'::jsonb) FROM pg_temp.native_timestamp_rows;
"""


def queries():
    path = ROOT/'scripts/sql/canonical-user-rbac-repair-catalog.sql'
    raw = path.read_bytes()
    if path.resolve() != path or hashlib.sha256(raw).hexdigest() != CATALOG_SHA:
        raise ValueError('NATIVE_TIMESTAMP_SNAPSHOT_SOURCE_REQUIRED')
    query = raw.decode().replace("n.nspname IN ('public','auth','storage')", NAMESPACE)
    query = query.replace("'relocatable',e.extrelocatable)",
                          "'relocatable',e.extrelocatable,'comment',obj_description(e.oid,'pg_extension'))")
    query = query.replace("'base',format_type(t.typbasetype,t.typtypmod)",
                          "'acl',t.typacl,'base',format_type(t.typbasetype,t.typtypmod)")
    query = query.replace("\n)\nSELECT coalesce(jsonb_object_agg", EXTRA.format(namespace=NAMESPACE)+
                          "\n)\nSELECT coalesce(jsonb_object_agg")
    return query, ROWS.replace('{namespace}', NAMESPACE)


PROBE = 'gridex_timestamp_snapshot_probe'
SETUP = """
CREATE SCHEMA gridex_timestamp_snapshot_probe;
REVOKE ALL ON SCHEMA supabase_migrations FROM anon;
REVOKE ALL ON SCHEMA gridex_timestamp_snapshot_probe FROM PUBLIC,anon;
CREATE TABLE gridex_timestamp_snapshot_probe.rows(id integer PRIMARY KEY,value text);
INSERT INTO gridex_timestamp_snapshot_probe.rows VALUES(1,'before');
CREATE TYPE gridex_timestamp_snapshot_probe.enum AS ENUM('before');
CREATE DOMAIN gridex_timestamp_snapshot_probe.domain AS integer;
CREATE FUNCTION gridex_timestamp_snapshot_probe.fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE FUNCTION gridex_timestamp_snapshot_probe.ledger_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END;$$;
CREATE TRIGGER gridex_timestamp_snapshot_ledger BEFORE INSERT ON supabase_migrations.schema_migrations
 FOR EACH ROW EXECUTE FUNCTION gridex_timestamp_snapshot_probe.ledger_fn();
"""
ADMIN_CONTROLS = {
    'setup': """CREATE FUNCTION gridex_timestamp_snapshot_probe.event_fn() RETURNS event_trigger
 LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$;
 CREATE EVENT TRIGGER gridex_timestamp_snapshot_event ON ddl_command_end
 EXECUTE FUNCTION gridex_timestamp_snapshot_probe.event_fn();""",
    'extension': "COMMENT ON EXTENSION plpgsql IS 'native timestamp snapshot detection control';",
    'event_trigger': 'ALTER EVENT TRIGGER gridex_timestamp_snapshot_event DISABLE;',
}
CONTROLS = (
    ('enum', 0, 'type/'+PROBE+'.enum', "ALTER TYPE "+PROBE+".enum ADD VALUE 'after';"),
    ('extension', 0, 'extension/plpgsql', "COMMENT ON EXTENSION plpgsql IS 'native timestamp snapshot detection control';"),
    ('function', 0, 'function/'+PROBE+'.fn()', 'CREATE OR REPLACE FUNCTION '+PROBE+".fn() RETURNS integer LANGUAGE sql AS 'SELECT 2';"),
    ('row', 1, PROBE+'.rows', 'UPDATE '+PROBE+".rows SET value='after' WHERE id=1;"),
    ('schema_acl', 0, 'schema/'+PROBE, 'GRANT USAGE ON SCHEMA '+PROBE+' TO anon;'),
    ('domain', 0, 'domain_constraint/'+PROBE+'.domain/positive', 'ALTER DOMAIN '+PROBE+'.domain ADD CONSTRAINT positive CHECK(VALUE>0);'),
    ('ledger_schema_acl', 0, 'schema/supabase_migrations', 'GRANT USAGE ON SCHEMA supabase_migrations TO anon;'),
    ('ledger_trigger', 0, 'trigger/supabase_migrations.schema_migrations/gridex_timestamp_snapshot_ledger', 'ALTER TABLE supabase_migrations.schema_migrations DISABLE TRIGGER gridex_timestamp_snapshot_ledger;'),
    ('event_trigger', 0, 'event_trigger/gridex_timestamp_snapshot_event', 'ALTER EVENT TRIGGER gridex_timestamp_snapshot_event DISABLE;'),
)


def qualify(target):
    """Demand actual detection of each formerly invisible SQL effect on a clone."""
    clone = 'gridex_native_timestamp_phase'
    parent = target.snapshot()
    target.clone('postgres', clone)
    cases = []
    try:
        target.sql(clone, SETUP, 'timestamp_snapshot_setup')
        target.snapshot_admin_control('setup')
        for name, image, key, mutation in CONTROLS:
            before = target.snapshot(clone)
            if name in ADMIN_CONTROLS:
                target.snapshot_admin_control(name)
            else:
                target.sql(clone, mutation, 'timestamp_snapshot_control_'+name)
            after = target.snapshot(clone)
            if key not in after[image] or before[image].get(key) == after[image][key]:
                raise ValueError('NATIVE_TIMESTAMP_SNAPSHOT_DETECTION_REQUIRED')
            cases.append({'case': name, 'changedObjectDetected': True})
    finally:
        target.drop_clone(clone)
    if target.snapshot() != parent:
        raise ValueError('NATIVE_TIMESTAMP_SNAPSHOT_PARENT_CHANGED')
    return {'nonSystemSchemasCovered': True, 'ledgerVerifiedSeparately': True,
            'cases': cases, 'parentUnchanged': True}
