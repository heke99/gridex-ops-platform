#!/usr/bin/env python3
"""Real object append/witness/snapshot regression, fixed disposable localhost only.

Commits the exact SQL regression fixture and intentionally retains immutable rows
until the disposable database is destroyed. No connection parameters are accepted.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import uuid

# Reuse the established fixed localhost connection and environment stripping.
sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location(
    'local_regression', Path(__file__).with_name('ediel-source-validation-concurrency-regression.py'))
_db = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_db)
checked, denied, literal = _db.checked, _db.denied, _db.literal
COMPANY = '00000000-0000-4000-8000-00000000f001'
OUTSIDER = '00000000-0000-4000-8000-00000000f002'
SOURCE = '00000000-0000-4000-8000-00000000f501'
TABLE = 'gridex_received_sources.object_assessments'


def service(expression):
    return 'SET ROLE service_role; SELECT ' + expression + ';'


def main():
    assert len(sys.argv) == 1, 'This disposable test accepts no connection arguments'
    assert _db.URL == 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    assert checked(f"SELECT count(*) FROM {TABLE} WHERE source_message_id='{SOURCE}';") == '0', 'Use a fresh disposable database'
    fixture = Path(__file__).with_name('ediel-source-object-decisions-regression.sql').read_text()
    assert re.search(r'ROLLBACK;\s*\Z', fixture), 'Fixture must end with rollback'
    result = _db.execute(re.sub(r'ROLLBACK;\s*\Z', 'COMMIT;\n', fixture), timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'checks PASS' in result.stderr, result.stdout + result.stderr

    chain_query = f"""WITH RECURSIVE chain AS (
 SELECT a.*,0 AS depth FROM {TABLE} a WHERE source_message_id='{SOURCE}' AND previous_assessment_id IS NULL
 UNION ALL SELECT a.*,c.depth+1 FROM {TABLE} a JOIN chain c ON a.previous_assessment_id=c.id
) SELECT jsonb_agg(jsonb_build_object('id',id,'previous',previous_assessment_id,'facts',facts_text,
'hash',facts_hash,'canonical',canonical_assessment_id,'payload',source_payload_hash,'xid',created_xid::text) ORDER BY depth) FROM chain;"""
    baseline = json.loads(checked(chain_query))
    assert len(baseline) == 2
    first, correction = baseline
    assert json.loads(first['facts'])['objects'][0]['disposition'] == 'accepted'
    assert json.loads(correction['facts'])['objects'][0]['disposition'] == 'unavailable'

    def append(facts):
        return (f"public.gridex_record_source_object_decisions_v1('{COMPANY}','test','{SOURCE}',"
                f"'{first['payload']}','{first['canonical']}',{literal(facts)})")

    def witness(row, company=COMPANY, environment='test', digest=None):
        return (f"public.gridex_witness_source_objects_v1('{company}',{literal(environment)},"
                f"'{row['id']}',{literal(digest or row['hash'])})")

    def snapshot(cutoff='clock_timestamp()', company=COMPANY, environment='test'):
        receipt = json.loads(checked(service(
            f"public.gridex_source_object_snapshot_v1('{company}',{literal(environment)},{cutoff})")))
        assert hashlib.sha256(receipt['readsetText'].encode()).hexdigest() == receipt['readsetHash']
        persisted = json.loads(checked("SELECT jsonb_build_object('text',readset_text,'hash',readset_hash) "
            f"FROM gridex_received_sources.object_selection_snapshots WHERE id='{receipt['snapshotId']}';"))
        assert persisted == {'text': receipt['readsetText'], 'hash': receipt['readsetHash']}
        return receipt, json.loads(receipt['readsetText'])

    # A caught subtransaction error cannot make the same top-level xid visible.
    checked(f"""BEGIN; SET LOCAL ROLE service_role;
DO $test$ DECLARE r jsonb; blocked boolean:=false; BEGIN
 r:={append(first['facts'])};
 BEGIN
  PERFORM public.gridex_witness_source_objects_v1('{COMPANY}','test',(r->>'assessmentId')::uuid,r->>'factsHash');
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'source_object_availability_unproven' THEN RAISE; END IF; blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'same top-level transaction witnessed'; END IF;
END $test$; ROLLBACK;""")
    assert json.loads(checked(chain_query)) == baseline

    second_facts = json.dumps(json.loads(first['facts']), separators=(',', ':')) + ' '
    application = 'object_append_probe_' + uuid.uuid4().hex
    a = b = None
    try:
        a = _db.start("BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE service_role;\n"
            + f"SELECT 'A_RECEIPT='||{append(first['facts'])}::text;\nSELECT 'WRITER_PID='||pg_backend_pid();\n\\echo WRITER_A_READY\n")
        output = _db.ready(a, 'WRITER_A_READY')
        pid = int(re.search(r'WRITER_PID=(\d+)', output).group(1))
        uncommitted = json.loads(re.search(r'A_RECEIPT=(.+)', output).group(1))
        denied(service(witness({'id': uncommitted['assessmentId'], 'hash': uncommitted['factsHash']})),
               '23514', 'source_object_availability_unproven')
        b = _db.start(f"SET application_name={literal(application)}; BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL ROLE service_role;\n"
            + f"SELECT {append(second_facts)}; COMMIT;\n\\echo WRITER_B_COMMITTED\n\\q\n")
        deadline = time.monotonic() + 10
        while checked(f"SELECT count(*) FROM pg_stat_activity WHERE application_name={literal(application)} "
                       f"AND state='active' AND wait_event_type='Lock' AND {pid}=ANY(pg_blocking_pids(pid));") != '1':
            assert b.poll() is None and time.monotonic() < deadline, 'Second append never blocked on first source lock'
        assert json.loads(checked(chain_query)) == baseline, 'Uncommitted appends became visible'
        _db.finish(a, 'COMMIT;')
        _db.ready(b, 'WRITER_B_COMMITTED')
        b.stdin.close()
        b.wait(timeout=10)
        assert b.returncode == 0, b.stdout.read()
    finally:
        for proc in (a, b):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
    rows = json.loads(checked(chain_query))
    assert len(rows) == 4 and rows[:2] == baseline
    for index, expected in ((2, first['facts']), (3, second_facts)):
        row = rows[index]
        assert row['previous'] == rows[index - 1]['id'] and row['facts'] == expected
        assert row['hash'] == hashlib.sha256(expected.encode()).hexdigest()
        assert row['canonical'] == first['canonical'] and row['payload'] == first['payload']
    assert rows[2]['xid'] != rows[3]['xid']

    before_receipt, before_body = snapshot()
    assert before_body['complete'] and before_body['sourceCount'] == 1
    assert len(before_body['sources'][0]['assessments']) == 4
    assert all(row['availableAt'] is None for row in before_body['sources'][0]['assessments'])
    cutoff = checked('SELECT clock_timestamp();')
    for row in rows[2:]:
        received = json.loads(checked(service(witness(row))))
        assert received == json.loads(checked(service(witness(row)))), 'Witness was not idempotent'
        assert received['assessmentId'] == row['id'] and received['factsHash'] == row['hash']
        denied(service(witness(row, company=OUTSIDER)), '23514', 'source_object_availability_unproven')
        denied(service(witness(row, environment='production')), '23514', 'source_object_availability_unproven')
        denied(service(witness(row, digest='0' * 64)), '23514', 'source_object_availability_unproven')
    denied(service(witness({'id': str(uuid.uuid4()), 'hash': rows[2]['hash']})),
           '23514', 'source_object_availability_unproven')
    assert checked(f"SELECT bool_and(w.observed_at>a.assessed_at AND w.observed_at>{literal(cutoff)}::timestamptz) "
        f"FROM gridex_received_sources.object_availability_witnesses w JOIN {TABLE} a ON a.id=w.assessment_id WHERE a.source_message_id='{SOURCE}';") == 't'
    _, after_body = snapshot(literal(cutoff) + '::timestamptz')
    # A snapshot includes visible evidence with its actual later availability;
    # the consumer must compare availability against cutoff, never backdate it.
    later = {row['id']: row for row in after_body['sources'][0]['assessments']}
    assert all(later[row['id']]['availableAt'] and later[row['id']]['availabilityWitnessId'] for row in rows[2:])
    _, empty = snapshot("'1970-01-01'::timestamptz")
    assert empty['complete'] and empty['sourceCount'] == 0 and empty['sources'] == []
    for kwargs in ({'company': OUTSIDER}, {'environment': 'production'}):
        _, scoped = snapshot(**kwargs)
        assert scoped['complete'] and scoped['sourceCount'] == 0 and scoped['sources'] == []
    for cutoff_sql in ("'infinity'::timestamptz", "clock_timestamp()+interval '1 day'", 'NULL::timestamptz'):
        denied(service(f"public.gridex_source_object_snapshot_v1('{COMPANY}','test',{cutoff_sql})"), '22023')
    denied(service(f"public.gridex_source_object_snapshot_v1('{COMPANY}','invalid',clock_timestamp())"), '22023')

    for role in ('anon', 'authenticated'):
        denied(f'SET ROLE {role}; SELECT {witness(rows[2])};', '42501')
        denied(f"SET ROLE {role}; SELECT public.gridex_source_object_snapshot_v1('{COMPANY}','test',clock_timestamp());", '42501')
    for table in ('object_availability_witnesses', 'object_selection_snapshots'):
        qualified = 'gridex_received_sources.' + table
        for role in ('anon', 'authenticated', 'service_role'):
            denied(f'SET ROLE {role}; SELECT * FROM {qualified};', '42501')
            denied(f'SET ROLE {role}; DELETE FROM {qualified};', '42501')
        denied(f'UPDATE {qualified} SET id=id;', '23514')
        denied(f'DELETE FROM {qualified};', '23514')
        denied(f'TRUNCATE {qualified};', '23514')
    denied(f"UPDATE {TABLE} SET facts_text=facts_text WHERE source_message_id='{SOURCE}';", '23514')
    assert json.loads(checked(chain_query)) == rows

    # Exercise the actual assessment budget, including the exact boundary. Each
    # row goes through the real append owner; no evidence/ACL/trigger bypass.
    checked(f"SET ROLE service_role; DO $budget$ BEGIN FOR i IN 1..124 LOOP PERFORM {append(correction['facts'])}; END LOOP; END $budget$;")
    _, boundary = snapshot()
    assert boundary['complete'] and len(boundary['sources'][0]['assessments']) == 128
    checked(service(append(correction['facts'])))
    _, incomplete = snapshot()
    assert not incomplete['complete'] and incomplete['sourceCount'] == 1 and incomplete['sources'] == []
    original = json.loads(checked("SELECT jsonb_build_object('text',readset_text,'hash',readset_hash) "
        f"FROM gridex_received_sources.object_selection_snapshots WHERE id='{before_receipt['snapshotId']}';"))
    assert original == {'text': before_receipt['readsetText'], 'hash': before_receipt['readsetHash']}
    assert len(json.loads(checked(chain_query))) == 129
    print('SOURCE_OBJECT_CONCURRENCY: PASS observed blocking, immutable predecessor chain, prior-transaction witness, exact immutable snapshots, cutoff/scope/ACL and budget guards; disposable synthetic source=' + SOURCE, flush=True)


if __name__ == '__main__':
    main()
