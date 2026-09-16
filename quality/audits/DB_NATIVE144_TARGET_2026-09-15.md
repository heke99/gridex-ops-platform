# Native DB2 target admission and preservation — 2026-09-15

Status: IMPLEMENTED_LOCAL_TESTS_PASS; NATIVE_RESULT_PENDING; NOT MERGED.
Base: d8ace45ceedc29ef911352f249967d378fd3351a. No historical SQL changed.
Backup: backup/pr310-20260915-d8ace45c retains the complete existing PR ancestry.
The previous ten-file auth-evidence patch has been applied, not reimplemented.

## Actual latest execution, not stale PR prose

Ordinary OPS34939777875/artifact10385038918 reaches all144 foundation inputs
and five of seven residual inputs. Six canonical groups execute and verify
real CLI ledger statements, negative controls and no-op repeats. The seventh
(residual144) stops at its first expectedP1480 control with55000/stageR071.
The full foundation group is NOT accepted. The original1-77 acceptance remains
valid; no timestamp input has run. Owned resources and private workspace are
successfully disposed. The report is not a full schema-equality certificate.

## Confirmed source defect and narrow correction

R071 is the pinned DB2 preflight reconstructed by canonical-db2-reconstruction.py.
Its invitation-index transition admits only databases gridex_auth_legacy_replay
and gridex_auth_legacy_atomic. The native lifecycle intentionally uses postgres.
The predicate therefore always rejects this native target before inspecting
or repairing the known predecessor index. This is an environment mismatch,
not evidence of a missing auth table or permission to broaden index admission.

Only the native execution body transfers that one exact predicate. The new
predicate requires postgres role/database and the current transaction/backend's
private native_foundation_context row. The caller retains isolated owned-image,
provider contract, earlier ledger and exact source/support checks. The immutable
portable renderer and its source/rendered hashes remain unchanged. Original and
native execution-body hashes are separately reported.

The native qualification must FIRST reproduce the original55000 atR071 with
exact fixed reason DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED. Any other55000,
missing reason or wrong stage fails. Existing mid/body/CLI-ledger failure probes
remain mandatory afterwards. Both the legacy-operator scope ban and every index
shape/uniqueness/dependency/property check are retained. No privilege is granted,
no trigger disabled and no unknown index is dropped. No production target is used.

## Local verification and review

Four new regression tests were observed RED before implementation. All27 native
foundation source/control tests and16 preserved auth-evidence tests then PASS.
601 immutable migration files/505 version groups PASS checksum integrity.
git diff --check PASS. Local callbacks are NOT native database proof. There is
no Docker/PostgreSQL runtime in this local workspace; CI must prove the SQL.

Differential self-review: changes affect native test-admission rendering,
qualification and redacted error hints only, plus the previous auth-evidence
runner/workflow. No application/API/tenant/RLS/production schema change. The
fixed error hint never exports arbitrary SQLERRM. Existing portable tests retain
their original database whitelist. No independent external review is claimed.

## Next gates

Read ordinary OPS and the new gridex-auth-membership-group artifact on this
published code. Accept foundation144 only after all seven groups and controls
pass. Then integrate the existing source-admitted timestamp driver with the
real native CLI ledger, full source accounting and rollback/commit semantics.
After complete replay: independent schema/reference reconciliation, actual
auth-group fix, genuine type generation, mandatory CI/E2E and full-PR merge.
Do not weaken a gate, change a reference fingerprint, or update a type manifest
without generating its accepted types.

Skill routing: systematic debugging, test-driven development, Supabase/source
contract review, differential security review and verification-before-completion.
UI/React/marketing/deployment/performance skills are not triggered by this change.
PostgreSQL17 DO/RAISE documentation was checked for nested execution and fixed
error-hint semantics. Supabase changelog fetch returned unsupported markdown;
no provider version or CLI command is changed here.
