"""Native SQL checks restricted to the disposable loopback staff database."""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATABASE = "gridex_staff_api_synthetic"
EXPECTED = {"GRIDEX_STAFF_API_NATIVE_TEST": "1", "PGHOST": "127.0.0.1", "PGPORT": "55438", "PGDATABASE": DATABASE}
for key, value in EXPECTED.items():
    if os.environ.get(key) != value:
        raise SystemExit(f"Native staff fixtures require explicit {key}={value}")
if not os.environ.get("PGUSER"):
    raise SystemExit("Explicit native PGUSER is required")
PSQL = shutil.which("psql")
if not PSQL:
    raise SystemExit("A PostgreSQL client is required")
ENV = dict(os.environ)
for key in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"):
    ENV.pop(key, None)
ENV.update(PGCONNECT_TIMEOUT="5", PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=10000")
ARGS = [PSQL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", "127.0.0.1", "-p", "55438", "-d", DATABASE, "-U", ENV["PGUSER"]]


def query(sql):
    process = subprocess.run(ARGS, input=sql, text=True, capture_output=True, env=ENV, timeout=45)
    if process.returncode:
        raise RuntimeError(process.stderr.strip())
    return process.stdout.strip()


def literal(value):
    """SQL literals are synthetic constants/results, never shell interpolation."""
    return "'" + str(value).replace("'", "''") + "'"


def service_query(sql):
    return query("SET ROLE service_role;\n" + sql)


def service_json(sql):
    return json.loads(service_query(sql))


def attempt(sql):
    try:
        return {"ok": True, "value": service_json(sql)}
    except RuntimeError as error:
        return {"ok": False, "error": str(error)}


def parallel(sqls, workers=8):
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(attempt, sqls))


def expect_error(result, code, message):
    if result["ok"] or code not in result["error"] or message not in result["error"]:
        raise AssertionError(f"Expected native {code}/{message}, got {result}")


def wait_backend(name, wait_type, wait_event=None):
    """Observe a real backend wait; never infer synchronization from a sleep."""
    predicate = f"application_name={literal(name)} AND wait_event_type={literal(wait_type)}"
    if wait_event:
        predicate += f" AND wait_event={literal(wait_event)}"
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if query(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE {predicate});") == "t":
            return
        time.sleep(0.05)
    raise AssertionError(f"Native backend {name} never reached {wait_type}/{wait_event}")


def named(name, sql):
    return f"SET application_name={literal(name)};\n{sql}"


engine = query("SELECT current_database()||'|'||current_setting('server_version');")
name, version = engine.split("|", 1)
if name != DATABASE or version.split(".")[0] not in ("16", "17"):
    raise SystemExit("Expected disposable PostgreSQL 16/17 staff database")
expected_version = os.environ.get("GRIDEX_STAFF_NATIVE_VERSION")
if expected_version and version.split()[0] != expected_version:
    raise SystemExit("Native PostgreSQL version differs from the pinned matrix")
if query("SELECT count(*) FROM pg_namespace WHERE nspname='auth';") != "0":
    raise SystemExit("Refusing to replay staff fixtures over a preexisting database")

fixture = subprocess.run([shutil.which("node") or "node", "scripts/lib/staff-sql-fixture.cjs"], cwd=ROOT, env=ENV, text=True, capture_output=True, timeout=20, check=True)
query(fixture.stdout)
required = {"20261003220000_staff_api_sessions.sql", "20261003220500_staff_support_commands.sql", "20261003221000_staff_support_attachments.sql"}
migrations = sorted((ROOT / "supabase/migrations").glob("20261003*_staff_*.sql"))
if not required.issubset({path.name for path in migrations}):
    raise SystemExit("Native package is missing a required staff forward migration")
source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (
    "scripts/staff-api-native-regression.py", "scripts/staff-api-sql-regression.sql", "scripts/lib/staff-sql-fixture.cjs",
    "scripts/sql/gridex-supabase-compatible-bootstrap.sql", "supabase/schema.sql")}
source_hashes["generated_fixture_sql"] = hashlib.sha256(fixture.stdout.encode()).hexdigest()
for path in migrations:
    text = path.read_text()
    if not text.strip():
        raise SystemExit(f"Unimplemented staff migration: {path.name}")
    source_hashes[str(path.relative_to(ROOT))] = hashlib.sha256(text.encode()).hexdigest()
    query(text)
regression = (ROOT / "scripts/staff-api-sql-regression.sql").read_text()
query(regression)

# Reuse only the synthetic setup section for independent connections. The
# behavioral test above rolls every fixture back; this database is disposable.
marker = "  -- STAFF_FIXTURE_SEED_END"
if regression.count(marker) != 1:
    raise SystemExit("Expected one explicit synthetic seed boundary")
query(regression.split(marker)[0] + "\nEND $$; COMMIT;\n")
COMMAND = """SELECT public.staff_api_support_command(
'99999999-9999-4999-8999-999999999999',1,'33333333-3333-4333-8333-333333333333',
'88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666',
'11111111-1111-4111-8111-111111111111','create','','native-concurrent-create-001',repeat('a',64),
jsonb_build_object('customer_reference',public.staff_api_public_reference('customer','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
'title','Concurrent synthetic support','priority','normal'));"""
if service_query("SELECT current_user;") != "service_role":
    raise AssertionError("Native business operations must use the fixture's actual service-role grants")
outcomes = parallel([COMMAND] * 8)
if any(not result["ok"] for result in outcomes):
    raise AssertionError(f"Service-role concurrent creation failed: {outcomes}")
results = [result["value"] for result in outcomes]
if sum(result["replayed"] is False for result in results) != 1 or any(result["data"] != results[0]["data"] for result in results):
    raise AssertionError("Concurrent original-key requests did not converge on one receipt")
if query("SELECT count(*) FROM public.customer_cases WHERE company_id='11111111-1111-4111-8111-111111111111';") != "1":
    raise AssertionError("Concurrent creation produced duplicate business cases")
if query("SELECT count(*) FROM public.audit_logs WHERE action='staff_support_create';") != "1":
    raise AssertionError("Concurrent creation produced duplicate business audits")
if query("SELECT count(*) FROM public.customer_case_events WHERE event_type='created';") != "1":
    raise AssertionError("Concurrent creation produced duplicate conversation events")

COMPANY = "11111111-1111-4111-8111-111111111111"
STAFF = "33333333-3333-4333-8333-333333333333"
CLIENT = "66666666-6666-4666-8666-666666666666"
NATIVE = "88888888-8888-4888-8888-888888888888"
SESSION = "99999999-9999-4999-8999-999999999999"
AUTH_SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CUSTOMER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
DIGEST = "a" * 64
CASE_REFERENCE = results[0]["data"]["case_reference"]
CASE_ID = query(f"SELECT id FROM public.customer_cases WHERE company_id={literal(COMPANY)};")
# p_revision occupies the second argument rather than the second UUID.
ACTOR = f"{literal(SESSION)},1,{literal(STAFF)},{literal(NATIVE)},{literal(CLIENT)},{literal(COMPANY)}"
evidence = ["service-role original-key create: 8 callers, one case/event/audit/receipt"]


def acquire(key, revision=1, refresh_hash="c" * 64, digest=DIGEST):
    return f"SELECT public.staff_api_acquire_session_operation({literal(AUTH_SESSION)},{literal(CLIENT)},{literal(COMPANY)},{literal(key)},'refresh',{literal(digest)},{revision},{literal(refresh_hash)});"


# Every contender executes the actual service-only lease command on a separate
# connection. One caller may consume the provider operation; the rest must wait.
auth_key = "native-refresh-concurrent-001"
auth_outcomes = parallel([acquire(auth_key)] * 8)
if any(not item["ok"] for item in auth_outcomes):
    raise AssertionError(f"Concurrent Auth lease call failed: {auth_outcomes}")
auth_values = [item["value"] for item in auth_outcomes]
if sorted(value["state"] for value in auth_values) != ["acquired"] + ["busy"] * 7:
    raise AssertionError(f"Auth same-key callers acquired multiple leases: {auth_values}")
auth_lease = next(value["lease_id"] for value in auth_values if value["state"] == "acquired")
completion = f"SELECT to_jsonb(public.staff_api_complete_session_operation({literal(AUTH_SESSION)},{literal(auth_lease)},'new_synthetic_ciphertext',{literal(NATIVE)},'authenticated','aal1',{literal('e' * 64)},'synthetic_encrypted_receipt',true));"
completed = parallel([completion] * 8)
if sum(item["ok"] for item in completed) != 1 or next(item["value"] for item in completed if item["ok"]) != 2:
    raise AssertionError(f"Concurrent Auth finalization advanced more than one revision: {completed}")
for item in completed:
    if not item["ok"]:
        expect_error(item, "42501", "Session operation no longer authorized")
replays = parallel([acquire(auth_key)] * 8)
if any(not item["ok"] or item["value"]["state"] != "replay" or item["value"]["receipt"] != "synthetic_encrypted_receipt" or item["value"]["session"]["revision"] != 2 for item in replays):
    raise AssertionError(f"Committed Auth operation did not converge on the exact encrypted receipt: {replays}")
if service_json(acquire(auth_key, digest="d" * 64))["state"] != "conflict":
    raise AssertionError("Changed Auth input was allowed to reuse an original operation key")
evidence.append("Auth same-key acquire/finalize/replay: 8 connections, one lease and revision")

# Force the completion to queue behind an uncommitted real logout. The wait is
# observed before commit; a serial logout-before-completion test is insufficient.
pending = service_json(f"SELECT public.staff_api_acquire_session_operation({literal(AUTH_SESSION)},{literal(CLIENT)},{literal(COMPANY)},'native-validate-pending-001','validate',{literal(DIGEST)},2,NULL);")
pending_lease = pending["lease_id"]
logout_sql = f"SELECT public.staff_api_logout_session({literal(AUTH_SESSION)},{literal(CLIENT)},{literal(COMPANY)},'native-logout-pending-001',{literal(DIGEST)},'synthetic_logout_receipt');"
late_completion = f"SELECT to_jsonb(public.staff_api_complete_session_operation({literal(AUTH_SESSION)},{literal(pending_lease)},'impossible_synthetic_ciphertext',{literal(NATIVE)},'authenticated','aal1',NULL,NULL,false));"
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    logout = pool.submit(service_query, named("staff-native-logout-lock", "BEGIN;" + logout_sql + "SELECT pg_sleep(3);COMMIT;"))
    wait_backend("staff-native-logout-lock", "Timeout", "PgSleep")
    queued = pool.submit(attempt, named("staff-native-late-finalize", late_completion))
    wait_backend("staff-native-late-finalize", "Lock")
    logout.result()
    expect_error(queued.result(), "42501", "Session operation no longer authorized")
if query(f"SELECT status||'|'||revision||'|'||encrypted_payload FROM public.staff_api_sessions WHERE id={literal(AUTH_SESSION)};") != "revoked|2|new_synthetic_ciphertext":
    raise AssertionError("A pending Auth finalization resurrected a logged-out session")
if query(f"SELECT status FROM public.staff_api_session_operations WHERE session_id={literal(AUTH_SESSION)} AND operation_key='native-validate-pending-001';") != "blocked":
    raise AssertionError("Logout left an earlier pending operation eligible for finalization")
evidence.append("logout commit defeats a completion observed waiting on the same session row")


def reserve(key="native-attachment-concurrent-001"):
    return f"SELECT public.staff_api_attachment_reserve({ACTOR},{literal(CASE_REFERENCE)},{literal(key)},{literal(DIGEST)},'synthetic.pdf','application/pdf',100,{literal(DIGEST)},'internal');"


reservations = parallel([reserve()] * 8)
acquired = [item["value"] for item in reservations if item["ok"]]
if len(acquired) != 1 or acquired[0]["state"] != "acquired":
    raise AssertionError(f"Attachment contenders created multiple original reservations: {reservations}")
for item in reservations:
    if not item["ok"]:
        expect_error(item, "55000", "idempotency_in_progress")
attachment_reference = acquired[0]["row"]["public_reference"]
storage_path = acquired[0]["row"]["storage_path"]
old_lease = acquired[0]["lease_id"]
service_query(f"SELECT public.staff_api_attachment_release({ACTOR},{literal(CASE_REFERENCE)},'native-attachment-concurrent-001',{literal(DIGEST)},{literal(attachment_reference)},{literal(old_lease)});")
recoveries = parallel([reserve()] * 8)
recovered = [item["value"] for item in recoveries if item["ok"]]
if len(recovered) != 1 or recovered[0]["state"] != "acquired" or recovered[0]["row"]["public_reference"] != attachment_reference or recovered[0]["row"]["storage_path"] != storage_path or recovered[0]["lease_id"] == old_lease:
    raise AssertionError(f"Concurrent attachment recovery failed stable-reference/single-new-lease invariant: {recoveries}")
for item in recoveries:
    if not item["ok"]:
        expect_error(item, "55000", "idempotency_in_progress")


def finalize(lease):
    return f"SELECT public.staff_api_attachment_finalize({ACTOR},{literal(CASE_REFERENCE)},'native-attachment-concurrent-001',{literal(DIGEST)},{literal(attachment_reference)},{literal(lease)},{literal(DIGEST)},100,'released','application/pdf',NULL,'synthetic.pdf');"


expect_error(attempt(finalize(old_lease)), "55000", "idempotency_in_progress")
finalizations = parallel([finalize(recovered[0]["lease_id"])] * 8)
if any(not item["ok"] for item in finalizations) or sum(item["value"]["replayed"] is False for item in finalizations) != 1 or any(item["value"]["row"] != finalizations[0]["value"]["row"] for item in finalizations):
    raise AssertionError(f"Attachment finalization did not converge on one stable released row: {finalizations}")
reservation_replays = parallel([reserve()] * 8)
if any(not item["ok"] or item["value"]["state"] != "replay" or item["value"]["row"] != finalizations[0]["value"]["row"] for item in reservation_replays):
    raise AssertionError("Completed attachment reservation replay changed its canonical row")
if query("SELECT count(*) FROM public.audit_logs WHERE action='staff_support_attachment_reserved';") != "1" or query("SELECT count(*) FROM public.audit_logs WHERE action='staff_support_attachment_released';") != "1":
    raise AssertionError("Original attachment recovery/replay emitted duplicate reservation/finalization audits")
evidence.append("attachment reserve/recover/finalize/replay: 8 connections each, stable reference/path, stale lease denied")

# Hold a membership revocation uncommitted while the command waits for its
# contributing authorization row. The resumed writer must see the revocation.
note_key = "native-revoked-note-001"
note = f"SELECT public.staff_api_support_command({ACTOR},'note',{literal(CASE_REFERENCE)},{literal(note_key)},{literal(DIGEST)},'{{\"message\":\"Cannot survive membership revocation\"}}'::jsonb);"
before = query("SELECT count(*) FROM public.customer_case_events;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    revoke = pool.submit(query, named("staff-native-revocation-lock", f"BEGIN;UPDATE public.company_memberships SET status='revoked' WHERE company_id={literal(COMPANY)} AND user_id={literal(STAFF)};SELECT pg_sleep(3);COMMIT;"))
    wait_backend("staff-native-revocation-lock", "Timeout", "PgSleep")
    denied = pool.submit(attempt, named("staff-native-revocation-writer", note))
    wait_backend("staff-native-revocation-writer", "Lock")
    revoke.result()
    expect_error(denied.result(), "42501", "Staff command is not authorized")
if query("SELECT count(*) FROM public.customer_case_events;") != before or query(f"SELECT count(*) FROM public.staff_api_support_receipts WHERE idempotency_key={literal(note_key)};") != "0":
    raise AssertionError("A writer queued behind revocation persisted a conversation or protected receipt")
query(f"UPDATE public.company_memberships SET status='active' WHERE company_id={literal(COMPANY)} AND user_id={literal(STAFF)};")
evidence.append("membership revocation commit denies a writer observed waiting, with no event or receipt")

# A transaction may have begun before expiry, but authorization is evaluated
# after its content/session lock wait using wall-clock time, not transaction now().
query(f"UPDATE public.staff_api_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id={literal(SESSION)};")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    blocker = pool.submit(query, named("staff-native-expiry-lock", f"BEGIN;SELECT id FROM public.staff_api_sessions WHERE id={literal(SESSION)} FOR UPDATE;SELECT pg_sleep(4);COMMIT;"))
    wait_backend("staff-native-expiry-lock", "Timeout", "PgSleep")
    denied = pool.submit(attempt, named("staff-native-expiry-writer", note.replace(note_key, "native-expired-note-001")))
    wait_backend("staff-native-expiry-writer", "Lock")
    if query(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN public.staff_api_sessions s ON s.id={literal(SESSION)} WHERE a.application_name='staff-native-expiry-writer' AND a.xact_start<s.expires_at);") != "t":
        raise AssertionError("Expiry regression did not start the queued transaction before expiry")
    blocker.result()
    expect_error(denied.result(), "42501", "Staff command is not authorized")
if query("SELECT count(*) FROM public.staff_api_support_receipts WHERE idempotency_key='native-expired-note-001';") != "0":
    raise AssertionError("A session expired during a lock wait retained a protected write receipt")
query(f"UPDATE public.staff_api_sessions SET expires_at=clock_timestamp()+interval '8 hours' WHERE id={literal(SESSION)};")
evidence.append("session expiry during an observed lock wait denies a transaction started before expiry")

# The conversation timestamp and case version must describe the effect after
# its row-lock wait, rather than the caller's earlier transaction start time.
timed_key = "native-after-lock-note-001"
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    blocker = pool.submit(query, named("staff-native-timestamp-lock", f"BEGIN;SELECT id FROM public.customer_cases WHERE id={literal(CASE_ID)} FOR UPDATE;SELECT pg_sleep(3);COMMIT;"))
    wait_backend("staff-native-timestamp-lock", "Timeout", "PgSleep")
    writer = pool.submit(attempt, named("staff-native-timestamp-writer", note.replace(note_key, timed_key)))
    wait_backend("staff-native-timestamp-writer", "Lock")
    after_wait_started = query("SELECT clock_timestamp();")
    blocker.result()
    effect = writer.result()
    if not effect["ok"] or effect["value"]["replayed"] is not False:
        raise AssertionError(f"A valid writer did not resume after the content lock: {effect}")
    if query(f"SELECT {literal(effect['value']['data']['created_at'])}::timestamptz>={literal(after_wait_started)}::timestamptz AND updated_at>={literal(after_wait_started)}::timestamptz FROM public.customer_cases WHERE id={literal(CASE_ID)};") != "t":
        raise AssertionError("Event timestamp/case version used time before the observed content lock wait")
evidence.append("conversation timestamp and case version are captured after an observed content row-lock wait")

# Existing support/native/customer insertion paths share the same trigger quota.
# Seed 17 current rows including the recovered staff attachment, plus an old row
# and a foreign-tenant row that must not spend this customer's rolling quota.
insert_base = "INSERT INTO public.customer_case_attachments(company_id,customer_id,customer_case_id,public_reference,file_name,declared_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,scan_status,created_at)"
service_query(f"{insert_base} SELECT {literal(COMPANY)},{literal(CUSTOMER)},{literal(CASE_ID)},'support_attachment_'||replace(gen_random_uuid()::text,'-',''),'synthetic-'||g||'.pdf','application/pdf',100,{literal(DIGEST)},'synthetic/native-'||g,CASE WHEN g%2=0 THEN 'internal' ELSE 'customer' END,CASE WHEN g%2=0 THEN 'staff' ELSE 'customer' END,'quarantined',clock_timestamp() FROM generate_series(1,16) g;")
service_query(f"{insert_base} VALUES({literal(COMPANY)},{literal(CUSTOMER)},{literal(CASE_ID)},'support_attachment_'||replace(gen_random_uuid()::text,'-',''),'old-synthetic.pdf','application/pdf',100,{literal(DIGEST)},'synthetic/old','internal','staff','quarantined',clock_timestamp()-interval '25 hours');")
foreign_case = service_query("INSERT INTO public.customer_cases(company_id,customer_id,case_type,status,priority,title,source,metadata) VALUES('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','other','open','normal','Synthetic foreign quota','tenant_support_admin','{\"support_case\":true}') RETURNING id;")
service_query(f"{insert_base} VALUES('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc',{literal(foreign_case)},'support_attachment_'||replace(gen_random_uuid()::text,'-',''),'foreign-synthetic.pdf','application/pdf',100,{literal(DIGEST)},'synthetic/foreign','internal','staff','quarantined',clock_timestamp());")
if query(f"SELECT count(*) FROM public.customer_case_attachments WHERE company_id={literal(COMPANY)} AND customer_id={literal(CUSTOMER)} AND created_at>=clock_timestamp()-interval '24 hours';") != "17":
    raise AssertionError("Concurrent shared-quota precondition must have exactly seventeen current rows")
mixed = []
for index in range(12):
    if index % 3 == 0:
        mixed.append(reserve(f"native-quota-staff-{index:03d}"))
    else:
        uploaded_by = "customer" if index % 3 == 1 else "staff"
        visibility = "customer" if uploaded_by == "customer" else "internal"
        mixed.append(f"WITH inserted AS ({insert_base} VALUES({literal(COMPANY)},{literal(CUSTOMER)},{literal(CASE_ID)},'support_attachment_'||replace(gen_random_uuid()::text,'-',''),{literal(f'synthetic-quota-{index}.pdf')},'application/pdf',100,{literal(DIGEST)},{literal(f'synthetic/quota-{index}')},{literal(visibility)},{literal(uploaded_by)},'quarantined',clock_timestamp()) RETURNING public_reference) SELECT jsonb_build_object('state','inserted','reference',public_reference) FROM inserted;")
quota_results = parallel(mixed, workers=12)
if sum(item["ok"] for item in quota_results) != 3:
    raise AssertionError(f"Mixed staff/native/customer races did not consume exactly three remaining quota slots: {quota_results}")
for item in quota_results:
    if not item["ok"]:
        expect_error(item, "P0001", "attachment_quota_exceeded")
if query(f"SELECT count(*) FROM public.customer_case_attachments WHERE company_id={literal(COMPANY)} AND customer_id={literal(CUSTOMER)} AND created_at>=clock_timestamp()-interval '24 hours';") != "20":
    raise AssertionError("Concurrent mixed-path shared rolling attachment quota exceeded twenty")
if query(f"SELECT count(*) FROM public.customer_case_attachments WHERE company_id={literal(COMPANY)} AND customer_id={literal(CUSTOMER)};") != "21":
    raise AssertionError("A historical attachment incorrectly consumed a rolling quota slot")
evidence.append("mixed staff/native/customer quota: 12 concurrent paths, exactly 3 successes from 17 to 20 current rows")

print(json.dumps({"status": "passed", "database": DATABASE, "postgresql": version,
    "concurrent_original_key_requests": 8, "native_concurrency_programs": len(evidence),
    "forward_migrations": len(migrations), "source_sha256": source_hashes,
    "native_package_sha256": hashlib.sha256(json.dumps(source_hashes, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
    "executed_as": "service_role", "evidence": evidence,
    "full_supabase_replay": False, "provider_storage_verified": False}))
