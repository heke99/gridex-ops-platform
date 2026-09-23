#!/usr/bin/env python3
"""Real append serialization against disposable localhost replay only.

Commits a unique synthetic company/source and two assessments because independent
transactions must see the fixture. Immutable guards stay enabled; fixture IDs are
printed and intentionally retained until the disposable database is destroyed.
No connection arguments or PG/DATABASE_URL environment overrides are accepted.
"""
import hashlib
import json
import os
import re
import selectors
import subprocess
import time
import uuid

URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG') and k != 'DATABASE_URL'}
PSQL = ['psql', URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']


def execute(sql, timeout=20):
    return subprocess.run(PSQL, input=sql, text=True, capture_output=True, env=ENV, timeout=timeout)


def checked(sql):
    result = execute(sql)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def denied(sql, state, message=None):
    result = execute(sql)
    assert result.returncode != 0, 'Unexpected successful prohibited operation'
    assert re.search(r'ERROR:\s+' + state + ':', result.stderr), result.stdout + result.stderr
    if message:
        assert message in result.stderr, result.stderr


def start(sql):
    proc = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1, env=ENV)
    assert proc.stdin and proc.stdout
    proc.stdin.write(sql)
    proc.stdin.flush()
    return proc


def ready(proc, marker):
    data = b''
    deadline = time.monotonic() + 20
    with selectors.DefaultSelector() as selector:
        selector.register(proc.stdout, selectors.EVENT_READ)
        while marker.encode() + b'\n' not in data:
            remaining = deadline - time.monotonic()
            assert remaining > 0 and selector.select(remaining), 'Readiness timeout: ' + data.decode(errors='replace')
            chunk = os.read(proc.stdout.fileno(), 4096)
            assert chunk, 'Writer exited before readiness: ' + data.decode(errors='replace')
            data += chunk
    return data.decode()


def finish(proc, sql):
    proc.stdin.write(sql + '\n\\q\n')
    proc.stdin.flush()
    proc.stdin.close()
    proc.wait(timeout=20)
    output = proc.stdout.read()
    assert proc.returncode == 0, output
    return output


def main():
    company, source, outsider = (str(uuid.uuid4()) for _ in range(3))
    raw = 'disposable register concurrency fixture ' + source
    payload_hash = hashlib.sha256(raw.encode()).hexdigest()
    application = 'ediel_append_probe_' + source
    print(f'SOURCE_VALIDATION_CONCURRENCY: disposable retained company={company} source={source}', flush=True)
    # Exactly the established fixture path: normal insert captures the sealed
    # source/context; no direct ledger insert and no trigger or RLS changes.
    checked(f"""
BEGIN;
SET LOCAL statement_timeout='10s';
INSERT INTO public.companies(id,name,status) VALUES('{company}','Disposable append concurrency fixture','active');
DO $fixture$
DECLARE p public.ediel_message_profiles%rowtype; r public.ediel_rule_packs%rowtype;
BEGIN
 SELECT * INTO STRICT p FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z04:L:26.A:r3' AND is_enabled;
 SELECT * INTO STRICT r FROM public.ediel_rule_packs WHERE id=p.rule_pack_id;
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,
 canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 VALUES('{source}','{company}','test','inbound','edifact','PRODAT','Z04','received',{literal(raw)},clock_timestamp(),
 r.id,p.profile_key,p.id,r.guide_version||':r'||r.guide_revision,r.source_hash,p.profile);
END $fixture$;
COMMIT;
""")
    pack = json.loads(checked("""SELECT jsonb_build_object('profileKey',p.profile_key,'messageProfileId',p.id,'rulePackId',r.id,'sourceHash',r.source_hash)
FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs r ON r.id=p.rule_pack_id
WHERE p.profile_key='PRODAT:Z04:L:26.A:r3' AND p.is_enabled;"""))
    facts = dict(version=1, owner='canonical-runtime-with-registry-v1', sourceDisposition='not_established',
                 objectDisposition='not_checked', partyDisposition='not_checked', coverage='canonical_runtime_only',
                 originalTenantMatch='matched', syntaxDecision='accepted', applicationDecision='accepted',
                 functionalDecision='accepted', messageReference='MSG', reasonCodes=[], rulePackEvidence=pack,
                 registerValidation=dict(version=1, owner='validateProdatRegisterPolicy', coverage='canonical_register_only', objects=[
                     dict(messageIndex=0, messageReference='MSG', objectId='MP-A', identityAgency='9', disposition='accepted',
                          registers=[dict(lineIndex=0, lineNumber='1', registerIndex=None, registerPosition=1, segmentIndex=3)], reasons=[])]))
    first = json.dumps(facts, separators=(',', ':'))
    facts['registerValidation']['objects'][0].update(disposition='rejected', reasons=['PRODAT_REGISTER_INVALID'])
    second = json.dumps(facts, separators=(',', ':'))

    def append(text, scope=company):
        return f"SELECT public.gridex_record_source_validation_v1('{scope}','test','{source}','{payload_hash}',{literal(text)});\n"

    a = b = None
    try:
        a = start("BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE service_role;\n"
                  + append(first) + "SELECT 'WRITER_PID='||pg_backend_pid();\n\\echo WRITER_A_READY\n")
        output = ready(a, 'WRITER_A_READY')
        pid = int(re.search(r'WRITER_PID=(\d+)', output).group(1))
        b = start(f"SET application_name={literal(application)}; BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL ROLE service_role;\n"
                  + append(second) + "COMMIT;\n\\echo WRITER_B_COMMITTED\n\\q\n")
        # Success requires observed server lock state, never a sleep duration.
        deadline = time.monotonic() + 10
        while True:
            blocked = checked(f"SELECT count(*) FROM pg_stat_activity WHERE application_name={literal(application)} "
                              f"AND state='active' AND wait_event_type='Lock' AND {pid}=ANY(pg_blocking_pids(pid));")
            if blocked == '1':
                break
            assert b.poll() is None and time.monotonic() < deadline, 'Second writer never blocked on first writer'
        assert checked(f"SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id='{source}';") == '0'
        finish(a, 'COMMIT;')
        ready(b, 'WRITER_B_COMMITTED')
        b.stdin.close()
        b.wait(timeout=10)
        assert b.returncode == 0, b.stdout.read()
    finally:
        for proc in (a, b):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)

    query = f"""SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'previous',previous_assessment_id,
'facts',facts_text,'hash',facts_hash,'company',company_id,'environment',environment,'payload',source_payload_hash)
ORDER BY previous_assessment_id NULLS FIRST),'[]'::jsonb)
FROM gridex_received_sources.validation_assessments WHERE source_message_id='{source}';"""
    before = checked(query)
    rows = json.loads(before)
    assert len(rows) == 2 and rows[0]['previous'] is None and rows[1]['previous'] == rows[0]['id'], rows
    for row, expected in zip(rows, (first, second)):
        assert row['facts'] == expected and row['hash'] == hashlib.sha256(expected.encode()).hexdigest(), row
        assert (row['company'], row['environment'], row['payload']) == (company, 'test', payload_hash), row
        assert json.loads(row['facts'])['sourceDisposition'] == 'not_established'
    denied('BEGIN; SET LOCAL ROLE service_role;\n' + append(second, outsider), '23514', 'received_validation_source_unavailable')
    for role in ('anon', 'authenticated'):
        denied(f'BEGIN; SET LOCAL ROLE {role};\n' + append(second), '42501')
    denied(f"BEGIN; UPDATE gridex_received_sources.validation_assessments SET facts_text=facts_text WHERE source_message_id='{source}';", '23514', 'received_source_evidence_is_append_only')
    assert checked(query) == before, 'Rejected outsider/role/mutation attempt altered history'
    print('SOURCE_VALIDATION_CONCURRENCY: PASS observed blocking, committed unique predecessor chain, exact immutable correction facts, tenant/role rejection; synthetic fixture retained', flush=True)


if __name__ == '__main__':
    main()
