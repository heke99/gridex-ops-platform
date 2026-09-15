"""Pause only the source postgres DB inside an admitted disposable native owner.

PG17 requires no other template sessions for CREATE DATABASE. ALLOW_CONNECTIONS
false blocks reconnection; existing sessions are terminated only in this exact
source OID, with a fixed count bound. This includes provider background sessions:
the entire isolated instance belongs to this proof, not to application traffic.
No backend PID, query, user name, connection detail or SQL output is published.

https://www.postgresql.org/docs/17/sql-createdatabase.html
https://www.postgresql.org/docs/17/sql-alterdatabase.html
https://www.postgresql.org/docs/17/app-createdb.html
"""
import json
import re

MAX_BACKENDS = 64
CATEGORIES = ('client', 'autovacuum', 'background', 'replication', 'other')
GUARD = """DO $owner$ BEGIN IF (current_user='supabase_admin'
 AND current_database()='template1'
 AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND inet_client_addr()='127.0.0.1'::inet
 AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=5432
 ) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NATIVE_CLONE_QUIESCE_OWNER_REQUIRED';
 END IF; END $owner$;
"""
INSPECT = """SELECT jsonb_build_object('database',to_jsonb(d),
 'owner',pg_get_userbyid(d.datdba),
 'settings',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.setrole),'[]'::jsonb)
             FROM pg_db_role_setting s WHERE s.setdatabase=d.oid),
 'backendCounts',(SELECT coalesce(jsonb_object_agg(category,n),'{}'::jsonb) FROM (
   SELECT CASE backend_type WHEN 'client backend' THEN 'client'
     WHEN 'autovacuum worker' THEN 'autovacuum'
     WHEN 'background worker' THEN 'background' WHEN 'walsender' THEN 'replication'
     ELSE 'other' END category,count(*) n
   FROM pg_stat_activity WHERE datid=d.oid GROUP BY 1) counts))
 FROM pg_database d WHERE d.datname='postgres';
"""


def _admin(target, operation, *, oid=None):
    """Finite maintenance operations; no SQL or destination argument is accepted."""
    if operation not in ('inspect', 'pause', 'drain', 'restore'):
        raise ValueError('NATIVE_CLONE_QUIESCE_OPERATION_REQUIRED')
    target.assert_native_owned()
    query = GUARD
    if operation == 'inspect':
        query += INSPECT
    else:
        if type(oid) is not str or re.fullmatch(r'[0-9]+', oid) is None:
            raise ValueError('NATIVE_CLONE_QUIESCE_SOURCE_REQUIRED')
        expected = 'true' if operation == 'pause' else 'false'
        allow = '' if operation == 'restore' else ' AND datallowconn IS '+expected
        query += ("DO $source$ BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname='postgres' "
                  "AND oid="+oid+"::oid AND pg_get_userbyid(datdba)='postgres' AND NOT datistemplate"+allow+
                  ") THEN RAISE EXCEPTION 'NATIVE_CLONE_QUIESCE_SOURCE_REQUIRED'; END IF; END $source$;\n")
        if operation in ('pause', 'restore'):
            query += 'ALTER DATABASE postgres ALLOW_CONNECTIONS '+('false' if operation == 'pause' else 'true')+';\n'
        else:
            query += ("DO $drain$ DECLARE backend record; BEGIN "
                      "IF (SELECT count(*) FROM pg_stat_activity WHERE datid="+oid+"::oid)>64 THEN "
                      "RAISE EXCEPTION 'NATIVE_CLONE_QUIESCE_BACKEND_LIMIT'; END IF; "
                      "FOR backend IN SELECT pid FROM pg_stat_activity WHERE datid="+oid+"::oid LOOP "
                      "IF pg_terminate_backend(backend.pid,1000) IS DISTINCT FROM true THEN "
                      "RAISE EXCEPTION 'NATIVE_CLONE_QUIESCE_DRAIN_REQUIRED'; END IF; END LOOP; "
                      "PERFORM pg_stat_clear_snapshot(); "
                      "IF EXISTS(SELECT FROM pg_stat_activity WHERE datid="+oid+"::oid) THEN "
                      "RAISE EXCEPTION 'NATIVE_CLONE_QUIESCE_DRAIN_REQUIRED'; END IF; END $drain$;\n")
        query += 'SELECT to_json(true);\n'
    args = ['docker','exec','-i',target.name,'psql','-X','-qAt','-w',
            '-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','template1',
            '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-f','-','--single-transaction']
    result = target._run(args, data=('-- native_clone_quiesce:'+operation+'\n'+query).encode(),
                         timeout=120, allow_failure=True)
    if result.returncode != 0:
        raise ValueError('NATIVE_CLONE_QUIESCE_'+operation.upper()+'_REQUIRED')
    try:
        answer = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise ValueError('NATIVE_CLONE_QUIESCE_RESPONSE_REQUIRED') from None
    if operation != 'inspect' and answer is not True:
        raise ValueError('NATIVE_CLONE_QUIESCE_RESPONSE_REQUIRED')
    return answer


def create_from_postgres(target, destination):
    from canonical_native_timestamp_proof import NativeTimestampTarget, CLONES
    from canonical_native_historical_prefix import LEDGER_SQL
    if type(target) is not NativeTimestampTarget or type(destination) is not str or destination not in CLONES:
        raise ValueError('NATIVE_CLONE_QUIESCE_OWNER_REQUIRED')
    target.assert_native_owned()
    if target._oid(destination) is not None:
        raise ValueError('NATIVE_TIMESTAMP_PREEXISTING_CLONE')
    state = _admin(target, 'inspect')
    database = state.get('database', {}) if type(state) is dict else {}
    oid = str(database.get('oid', ''))
    counts = state.get('backendCounts', {}) if type(state) is dict else {}
    if (database.get('datname') != 'postgres' or state.get('owner') != 'postgres'
            or database.get('datallowconn') is not True or database.get('datistemplate') is not False
            or not re.fullmatch(r'[0-9]+', oid) or type(state.get('settings')) is not list
            or type(counts) is not dict or set(counts)-set(CATEGORIES)
            or any(type(n) is not int or n < 0 for n in counts.values())
            or sum(counts.values()) > MAX_BACKENDS):
        raise ValueError('NATIVE_CLONE_QUIESCE_SOURCE_REQUIRED')
    before = target.snapshot()
    ledger = target.sql('postgres', LEDGER_SQL, 'clone_quiesce_ledger')
    print(json.dumps(dict(scope='OWNED_NATIVE_POSTGRES_CLONE_QUIESCENCE',
                          backendCounts={key:counts.get(key,0) for key in CATEGORIES}),sort_keys=True),flush=True)
    result = None
    try:
        # Enter finally before the pause command: a client failure may occur
        # after ALTER DATABASE committed. Restoration must still be attempted.
        _admin(target, 'pause', oid=oid)
        _admin(target, 'drain', oid=oid)
        result = target._run(['docker','exec',target.name,'createdb','-U','postgres',
                             '--maintenance-db=template1','-T','postgres',destination],
                            timeout=120, allow_failure=True)
    finally:
        try:
            _admin(target, 'restore', oid=oid)
            restored = _admin(target, 'inspect')
            if (restored.get('database') != database or restored.get('settings') != state['settings']
                    or restored.get('owner') != state['owner']):
                raise ValueError('NATIVE_CLONE_QUIESCE_RESTORE_REQUIRED')
        except BaseException:
            raise ValueError('NATIVE_CLONE_QUIESCE_RESTORE_REQUIRED') from None
        # Retain a successful create's OID for disposal even when the following
        # preservation check fails. This is cleanup ownership, not acceptance.
        if result is not None and result.returncode == 0:
            cloned_oid = target._oid(destination)
            if cloned_oid is None:
                raise ValueError('NATIVE_TIMESTAMP_CLONE_OWNERSHIP')
            target._owned[destination] = cloned_oid
        if target.snapshot() != before or target.sql('postgres', LEDGER_SQL, 'clone_quiesce_ledger') != ledger:
            raise ValueError('NATIVE_CLONE_QUIESCE_PRESERVATION_REQUIRED')
    return result
