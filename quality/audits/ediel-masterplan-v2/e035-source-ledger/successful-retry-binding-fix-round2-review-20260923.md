# Independent scoped review — fix round2

Reviewer /root/retry_binding_review, frozen range
cd5fc33cfc8a5eb2a6c0930a58eb3f714695c539..7fe841302bd17cbc33df1384df03608807a04c6f.
Supplied diff read once, focused frozen dependencies checked. No edits, test
reruns or hosted actions. SPEC: scoped fixes addressed. QUALITY: no new concrete
defects found. Native acceptance remains pending.

Important existing billing equality: ADDRESSED. Forward154221 lines37–41 adds
null-safe underlay_month/year/currency and payload.consumptionContracts checks.
Mismatch raises the existing internal conflict before return. Stored authority,
expected-contract equality, ownership locks, insert and service ACL preserved.
Legitimately mutable status, annotations and audit actors remain excluded.
Native test lines301–331 add five full-processor insertion/completion-gap
mutations and unchanged positive preserving row identity/workflow changes.
Appropriate regressions; execution pending at review.

Stale persisted readiness: ADDRESSED in implementation, execution pending.
Replay script422–432 refreshes after actual replay/fingerprint verification,
deriving migration version from executed timestamped inputs. New SQL4–26 logs
before/live/after and requires persisted readiness to equal ready live catalog.
Existing refresh implementation inspected at frozen schema.sql39306–39330:
capabilities/readiness/fingerprint derive from actual catalog view. No mocked
guard, forced-ready bit, relaxed policy or invented ledger entries. Actual
catalog satisfaction must be demonstrated by native execution.

No new concrete fix-introduced findings. Historical native114PASS/4FAIL remains
the latest executed result; the new124-case matrix must prove valid writes and
six completion-gap cases. Local checks were reviewed as reported claims, not
rerun. Overall scoped verdict: code-review pass, pending native verification;
not whole-task or whole-E035 approval.

Root publication: identical frozen treee093b316ceccffb968d3c7a43a9d06e72838fece
published327ba7af213064d52d6d6c79e414a04fd24714cb. Same-tree local synchronization
completed while implementer paused. OPS35884310774/native107260421275 started.
