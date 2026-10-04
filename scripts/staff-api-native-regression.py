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


def wait_transaction_blocked_by(waiter, blocker):
    """Require an observed row-owner XID wait, not merely a soft lock queue."""
    sql = f"""SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.application_name={literal(blocker)}
      JOIN pg_locks w ON w.pid=a.pid JOIN pg_locks held ON held.pid=b.pid
      WHERE a.application_name={literal(waiter)} AND a.wait_event_type='Lock'
        AND w.locktype='transactionid' AND NOT w.granted
        AND held.locktype='transactionid' AND held.granted AND held.mode='ExclusiveLock'
        AND w.transactionid=held.transactionid);"""
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if query(sql) == "t":
            return
        time.sleep(0.05)
    raise AssertionError(f"Native backend {waiter} never waited on the row owner {blocker}")


engine = query("SELECT current_database()||'|'||current_setting('server_version');")
name, version = engine.split("|", 1)
if name != DATABASE or version.split(".")[0] not in ("16", "17"):
    raise SystemExit("Expected disposable PostgreSQL 16/17 staff database")
expected_version = os.environ.get("GRIDEX_STAFF_NATIVE_VERSION")
if expected_version and version.split()[0] != expected_version:
    raise SystemExit("Native PostgreSQL version differs from the pinned matrix")
if query("SELECT count(*) FROM pg_namespace WHERE nspname='auth';") != "0":
    raise SystemExit("Refusing to replay staff fixtures over a preexisting database")

fixture = subprocess.run([shutil.which("node") or "node", "scripts/lib/staff-sql-fixture.cjs", "--postgres-major=" + version.split(".")[0]], cwd=ROOT, env=ENV, text=True, capture_output=True, timeout=20, check=True)
query(fixture.stdout)
required = {"20261003220000_staff_api_sessions.sql", "20261003220500_staff_support_commands.sql", "20261003221000_staff_support_attachments.sql", "20261003224139_staff_api_storage_integrity.sql", "20261003225321_staff_attachment_lock_order.sql", "20261003230216_staff_native_account_policy_columns.sql", "20261003231500_staff_machine_auth.sql", "20261003232132_staff_command_client_policy_binding.sql"}
migrations = sorted((ROOT / "supabase/migrations").glob("20261003*_staff_*.sql"))
if not required.issubset({path.name for path in migrations}):
    raise SystemExit("Native package is missing a required staff forward migration")
source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (
    "scripts/staff-api-native-regression.py", "scripts/staff-api-sql-regression.sql", "scripts/staff-api-machine-auth-regression.sql", "scripts/lib/staff-sql-fixture.cjs",
    "scripts/sql/gridex-supabase-compatible-bootstrap.sql", "supabase/schema.sql",
    "supabase/migrations/20260809191057_authenticate_integration_request_route_cost.sql",
    "supabase/migrations/20260810185155_gridex_canonical_architecture_p0.sql",
    "supabase/migrations/20260810224500_canonical_review_remediation_v1.sql")}
source_hashes["generated_fixture_sql"] = hashlib.sha256(fixture.stdout.encode()).hexdigest()
for path in migrations:
    text = path.read_text()
    if not text.strip():
        raise SystemExit(f"Unimplemented staff migration: {path.name}")
    source_hashes[str(path.relative_to(ROOT))] = hashlib.sha256(text.encode()).hexdigest()
    query(text)
regression = (ROOT / "scripts/staff-api-sql-regression.sql").read_text()
query(regression)
query((ROOT / "scripts/staff-api-machine-auth-regression.sql").read_text())

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

# Core commands acquire the actor mutation budget before the case. Force a note
# to own that budget while it waits on a held case, then start a new attachment.
# Reservation must queue on the note's budget XID before trying to own the case;
# the previous case->budget ordering either queued on the wrong owner or could
# deadlock with a core writer. Both actual commands must commit exactly once.
coexist_note_key = "native-note-attachment-coexist-001"
coexist_attachment_key = "native-attachment-note-coexist-001"
note_before = int(query("SELECT count(*) FROM public.customer_case_events WHERE event_type='support_internal_note';"))
attachment_before = int(query("SELECT count(*) FROM public.customer_case_attachments;"))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    blocker = pool.submit(query, named("staff-native-core-case-lock", f"BEGIN;SELECT id FROM public.customer_cases WHERE id={literal(CASE_ID)} FOR UPDATE;SELECT pg_sleep(5);COMMIT;"))
    wait_backend("staff-native-core-case-lock", "Timeout", "PgSleep")
    core_writer = pool.submit(attempt, named("staff-native-core-note-writer", note.replace(note_key, coexist_note_key)))
    wait_transaction_blocked_by("staff-native-core-note-writer", "staff-native-core-case-lock")
    upload_writer = pool.submit(attempt, named("staff-native-core-attachment-writer", reserve(coexist_attachment_key)))
    wait_transaction_blocked_by("staff-native-core-attachment-writer", "staff-native-core-note-writer")
    blocker.result()
    core_result, upload_result = core_writer.result(), upload_writer.result()
    if not core_result["ok"] or core_result["value"]["replayed"] is not False or not upload_result["ok"] or upload_result["value"]["state"] != "acquired":
        raise AssertionError(f"Same-actor core note and attachment did not both commit without a lock cycle: {core_result}, {upload_result}")
if int(query("SELECT count(*) FROM public.customer_case_events WHERE event_type='support_internal_note';")) != note_before + 1 or int(query("SELECT count(*) FROM public.customer_case_attachments;")) != attachment_before + 1:
    raise AssertionError("Concurrent core note/attachment produced missing or duplicate business effects")
if query(f"SELECT count(*) FROM public.staff_api_support_receipts WHERE idempotency_key={literal(coexist_note_key)};") != "1" or query(f"SELECT count(*) FROM public.staff_api_attachment_receipts WHERE idempotency_key={literal(coexist_attachment_key)};") != "1":
    raise AssertionError("Concurrent core note/attachment did not each retain exactly one protected receipt")
evidence.append("same actor/case note plus attachment: observed budget-before-case wait, both commit once without deadlock")

# Use a separate empty case so a canonical same-tenant customer move is legal
# under the real composite case-owner FKs. A reserve first observes customer A,
# waits on A's quota, then must reject the changed customer rather than recording
# an attachment under that old quota. The complete request/hash stays unchanged.
moved_customer = service_query(f"INSERT INTO public.customers(company_id,status,full_name,customer_number) VALUES({literal(COMPANY)},'active','Synthetic moved case customer','SYN-MOVED-QUOTA') RETURNING id;")
moved_case = service_query(f"INSERT INTO public.customer_cases(company_id,customer_id,case_type,status,priority,title,source,metadata) VALUES({literal(COMPANY)},{literal(CUSTOMER)},'other','open','normal','Synthetic moved-customer lock case','tenant_support_admin','{{\"support_case\":true}}') RETURNING id;")
moved_case_reference = service_query(f"SELECT public.staff_api_public_reference('support_case',{literal(COMPANY)},{literal(moved_case)});")
moved_key = "native-reserve-case-customer-moved-001"
moved_reserve = reserve(moved_key).replace(literal(CASE_REFERENCE), literal(moved_case_reference))
move_attachment_before = query("SELECT count(*) FROM public.customer_case_attachments;")
move_receipt_before = query("SELECT count(*) FROM public.staff_api_attachment_receipts;")
move_audit_before = query("SELECT count(*) FROM public.audit_logs WHERE action='staff_support_attachment_reserved';")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    blocker = pool.submit(query, named("staff-native-moved-customer-quota-lock", f"BEGIN;SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':','support-attachment-quota',{literal(COMPANY)},{literal(CUSTOMER)}),0));SELECT pg_sleep(5);COMMIT;"))
    wait_backend("staff-native-moved-customer-quota-lock", "Timeout", "PgSleep")
    queued = pool.submit(attempt, named("staff-native-moved-customer-reserve", moved_reserve))
    wait_backend("staff-native-moved-customer-reserve", "Lock", "advisory")
    if query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.application_name='staff-native-moved-customer-quota-lock' WHERE a.application_name='staff-native-moved-customer-reserve' AND b.pid=ANY(pg_blocking_pids(a.pid)));") != "t":
        raise AssertionError("Customer-move reserve was not observed waiting on the original customer quota")
    service_query(f"UPDATE public.customer_cases SET customer_id={literal(moved_customer)},updated_at=clock_timestamp() WHERE id={literal(moved_case)} AND company_id={literal(COMPANY)};")
    blocker.result()
    expect_error(queued.result(), "40001", "support_case_version_conflict")
if query("SELECT count(*) FROM public.customer_case_attachments;") != move_attachment_before or query("SELECT count(*) FROM public.staff_api_attachment_receipts;") != move_receipt_before or query("SELECT count(*) FROM public.audit_logs WHERE action='staff_support_attachment_reserved';") != move_audit_before:
    raise AssertionError("Customer changed during quota wait left an attachment, receipt or reservation audit")
if query(f"SELECT count(*) FROM public.staff_api_attachment_receipts WHERE idempotency_key={literal(moved_key)};") != "0":
    raise AssertionError("Denied unchanged upload request retained a receipt after case-customer movement")
if query(f"SELECT customer_id::text FROM public.customer_cases WHERE id={literal(moved_case)};") != moved_customer:
    raise AssertionError("Customer-move barrier failed to commit the actual canonical case owner")
evidence.append("case-customer move during observed original-quota wait: unchanged reserve returns 40001 and leaves no row/receipt/audit")

# A staff proof remains client-bound when a native business command resumes
# after a client-policy edit. Exercise both new work and the exact receipt from
# the first program: authorization must precede replay as well as creation.
policy_counts_sql = """SELECT jsonb_build_object(
  'cases',(SELECT count(*) FROM public.customer_cases),
  'events',(SELECT count(*) FROM public.customer_case_events),
  'audits',(SELECT count(*) FROM public.audit_logs),
  'receipts',(SELECT count(*) FROM public.staff_api_support_receipts));"""
original_create_key = "native-concurrent-create-001"
if COMMAND.count(original_create_key) != 1:
    raise AssertionError("Client-policy replay must reuse the first exact create command")
original_receipt_sql = f"SELECT to_jsonb(r) FROM public.staff_api_support_receipts r WHERE company_id={literal(COMPANY)} AND api_client_id={literal(CLIENT)} AND actor_user_id={literal(STAFF)} AND operation='create' AND resource_reference='' AND idempotency_key={literal(original_create_key)};"
client_policy_changes = (
    ("profile", "profile_key='tenant_website'", "profile_key='custom'"),
    ("kind", "metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{integration_kind}','\"tenant_website\"'::jsonb)",
     "metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{integration_kind}','\"staff_support_v1\"'::jsonb)"),
)


def queued_client_policy_change(name, change, sql):
    """Witness a command blocked by the transaction editing this client row."""
    blocker_name, waiter_name = f"staff-native-client-{name}-lock", f"staff-native-client-{name}-writer"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        blocker = pool.submit(query, named(blocker_name, f"BEGIN;UPDATE public.integration_api_clients SET {change} WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};SELECT pg_sleep(5);COMMIT;"))
        wait_backend(blocker_name, "Timeout", "PgSleep")
        queued = pool.submit(attempt, named(waiter_name, sql))
        wait_transaction_blocked_by(waiter_name, blocker_name)
        if query(f"""SELECT EXISTS(
          SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.application_name={literal(blocker_name)}
          JOIN pg_locks held ON held.pid=b.pid JOIN pg_locks owned ON owned.pid=a.pid
          JOIN pg_locks waiting ON waiting.pid=a.pid JOIN pg_locks xid_owner ON xid_owner.pid=b.pid
          WHERE a.application_name={literal(waiter_name)} AND a.wait_event_type='Lock'
            AND b.pid=ANY(pg_blocking_pids(a.pid))
            AND waiting.locktype='transactionid' AND NOT waiting.granted
            AND xid_owner.locktype='transactionid' AND xid_owner.granted AND xid_owner.mode='ExclusiveLock'
            AND waiting.transactionid=xid_owner.transactionid
            AND held.relation='public.integration_api_clients'::regclass AND held.granted AND held.mode='RowExclusiveLock'
            AND owned.relation=held.relation AND owned.granted AND owned.mode='RowShareLock');""") != "t":
            raise AssertionError("Client-policy command was not observed waiting on the actual integration client row owner")
        blocker.result()
        return queued.result()


for policy_name, change, restore in client_policy_changes:
    for mode in ("fresh", "replay"):
        if query(f"SELECT profile_key||'|'||(metadata->>'integration_kind') FROM public.integration_api_clients WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};") != "custom|staff_support_v1":
            raise AssertionError("Client-policy wait test requires the exact dedicated staff client")
        key = original_create_key if mode == "replay" else f"native-client-{policy_name}-fresh-create-001"
        receipt_sql = f"SELECT count(*) FROM public.staff_api_support_receipts WHERE company_id={literal(COMPANY)} AND api_client_id={literal(CLIENT)} AND actor_user_id={literal(STAFF)} AND operation='create' AND resource_reference='' AND idempotency_key={literal(key)};"
        receipt_before = query(receipt_sql)
        if receipt_before != ("1" if mode == "replay" else "0"):
            raise AssertionError(f"Client-policy {policy_name}/{mode} receipt precondition failed")
        counts_before = json.loads(query(policy_counts_sql))
        original_receipt_before = json.loads(query(original_receipt_sql))
        command = COMMAND if mode == "replay" else COMMAND.replace(original_create_key, key)
        try:
            expect_error(queued_client_policy_change(f"{policy_name}-{mode}", change, command), "42501", "Staff command is not authorized")
            if json.loads(query(policy_counts_sql)) != counts_before or query(receipt_sql) != receipt_before or json.loads(query(original_receipt_sql)) != original_receipt_before:
                raise AssertionError(f"Client-policy {policy_name}/{mode} denial changed a case, event, audit or protected receipt")
        finally:
            query(f"UPDATE public.integration_api_clients SET {restore} WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};")
        if query(f"SELECT profile_key||'|'||(metadata->>'integration_kind') FROM public.integration_api_clients WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};") != "custom|staff_support_v1":
            raise AssertionError("Client-policy wait test did not restore the exact staff client")
        restored = service_json(COMMAND)
        if restored["replayed"] is not True or restored["data"] != results[0]["data"] or json.loads(query(policy_counts_sql)) != counts_before or json.loads(query(original_receipt_sql)) != original_receipt_before:
            raise AssertionError("Restored client policy did not replay the exact existing response without effects")
        evidence.append(f"client {policy_name} change during observed client-row wait: {mode} create denied 42501 with no case/event/audit/receipt change")

# Mutable Auth must honor the same policy at bootstrap, acquisition and commit.
# Each variant owns a new synthetic vault row; the earlier Auth/logout and
# business session state remains untouched. A refused completion must persist
# its block rather than roll that block back with an exception.
old_auth_row = query(f"SELECT to_jsonb(s) FROM public.staff_api_sessions s WHERE id={literal(AUTH_SESSION)};")
for policy_name, change, restore in client_policy_changes:
    for auth_operation in ("bootstrap", "acquire", "complete"):
        if query(f"SELECT profile_key||'|'||(metadata->>'integration_kind') FROM public.integration_api_clients WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};") != "custom|staff_support_v1":
            raise AssertionError("Auth client-policy wait test requires the exact staff client")
        auth_id = query("SELECT gen_random_uuid();")
        auth_refresh_hash = hashlib.sha256(f"synthetic-client-policy:{auth_id}".encode()).hexdigest()
        auth_operation_key = f"native-auth-client-{policy_name}-{auth_operation}-001"
        bootstrap_sql = f"INSERT INTO public.staff_api_sessions(id,user_id,company_id,api_client_id,native_session_id,encrypted_payload,refresh_hash,stage,native_aal,expires_at) VALUES({literal(auth_id)},{literal(STAFF)},{literal(COMPANY)},{literal(CLIENT)},{literal(NATIVE)},'synthetic-client-policy-payload',{literal(auth_refresh_hash)},'authenticated','aal1',clock_timestamp()+interval '8 hours') RETURNING jsonb_build_object('session_id',id);"
        acquire_sql = f"SELECT public.staff_api_acquire_session_operation({literal(auth_id)},{literal(CLIENT)},{literal(COMPANY)},{literal(auth_operation_key)},'refresh',{literal(DIGEST)},1,{literal(auth_refresh_hash)});"
        if auth_operation != "bootstrap":
            service_json(bootstrap_sql)
        if auth_operation == "complete":
            pending_auth = service_json(acquire_sql)
            if pending_auth["state"] != "acquired":
                raise AssertionError("Mutable Auth policy completion requires an actual pending refresh lease")
            auth_sql = f"SELECT to_jsonb(public.staff_api_complete_session_operation({literal(auth_id)},{literal(pending_auth['lease_id'])},'must-never-commit-client-policy-payload',{literal(NATIVE)},'authenticated','aal1',{literal('f' * 64)},'must-never-commit-client-policy-receipt',true));"
        else:
            auth_sql = bootstrap_sql if auth_operation == "bootstrap" else acquire_sql
        vault_sql = f"SELECT to_jsonb(s) FROM public.staff_api_sessions s WHERE id={literal(auth_id)};"
        operations_sql = f"SELECT count(*) FROM public.staff_api_session_operations WHERE session_id={literal(auth_id)};"
        vault_before = query(vault_sql)
        operations_before = query(operations_sql)
        try:
            outcome = queued_client_policy_change(f"auth-{policy_name}-{auth_operation}", change, auth_sql)
            if auth_operation == "complete":
                if not outcome["ok"] or outcome["value"] != 0:
                    raise AssertionError(f"Revoked client Auth completion did not commit its private failure sentinel: {outcome}")
                blocked = json.loads(query(vault_sql))
                if blocked["status"] != "blocked" or blocked["lease_id"] is not None or blocked["lease_expires_at"] is not None or blocked["revision"] != 1 or blocked["encrypted_payload"] != "synthetic-client-policy-payload" or blocked["refresh_hash"] != auth_refresh_hash:
                    raise AssertionError("Refused Auth completion did not retain the old vault data and a durable cleared-lease block")
                if query(f"SELECT status||'|'||(encrypted_receipt IS NULL)::text||'|'||(completed_revision IS NULL)::text FROM public.staff_api_session_operations WHERE session_id={literal(auth_id)} AND operation_key={literal(auth_operation_key)};") != "blocked|true|true":
                    raise AssertionError("Refused Auth completion retained a pending operation or published an encrypted receipt")
            else:
                expect_error(outcome, "42501", "Staff integration client is not authorized")
                if query(vault_sql) != vault_before:
                    raise AssertionError("Refused Auth bootstrap/acquire created or modified a vault session")
            if query(operations_sql) != operations_before:
                raise AssertionError("Refused Auth client-policy command inserted or deleted an operation")
        finally:
            query(f"UPDATE public.integration_api_clients SET {restore} WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};")
        if query(f"SELECT profile_key||'|'||(metadata->>'integration_kind') FROM public.integration_api_clients WHERE id={literal(CLIENT)} AND company_id={literal(COMPANY)};") != "custom|staff_support_v1":
            raise AssertionError("Auth client-policy wait test did not restore the exact staff client")
        evidence.append(f"client {policy_name} change during observed client-row wait: Auth {auth_operation} refuses authority; completion blocks durably")
if query(f"SELECT to_jsonb(s) FROM public.staff_api_sessions s WHERE id={literal(AUTH_SESSION)};") != old_auth_row:
    raise AssertionError("Isolated Auth client-policy programs changed the earlier Auth/logout vault row")

# Existing support/native/customer insertion paths share the same trigger quota.
# Seed exactly 17 current rows including previously tested staff attachments, plus an old row
# and a foreign-tenant row that must not spend this customer's rolling quota.
insert_base = "INSERT INTO public.customer_case_attachments(company_id,customer_id,customer_case_id,public_reference,file_name,declared_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,scan_status,created_at)"
current_attachments = int(query(f"SELECT count(*) FROM public.customer_case_attachments WHERE company_id={literal(COMPANY)} AND customer_id={literal(CUSTOMER)} AND created_at>=clock_timestamp()-interval '24 hours';"))
seed_count = 17 - current_attachments
if seed_count < 0:
    raise AssertionError("Earlier concurrency programs exceeded the shared-quota seed target")
service_query(f"{insert_base} SELECT {literal(COMPANY)},{literal(CUSTOMER)},{literal(CASE_ID)},'support_attachment_'||replace(gen_random_uuid()::text,'-',''),'synthetic-'||g||'.pdf','application/pdf',100,{literal(DIGEST)},'synthetic/native-'||g,CASE WHEN g%2=0 THEN 'internal' ELSE 'customer' END,CASE WHEN g%2=0 THEN 'staff' ELSE 'customer' END,'quarantined',clock_timestamp() FROM generate_series(1,{seed_count}) g;")
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
