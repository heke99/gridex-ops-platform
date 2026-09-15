# PR310 native ledger fixture correction — 2026-09-15

Status: PARTIAL. Base335f987f0662da09e43eaf6cbd96158d657c9831.

## Routing and evidence

Applied systematic-debugging, test-driven-development, verification-before-completion,
using-git-worktrees and requesting-code-review for a bounded existing CI regression.
Supabase skill governs later native SQL work. No UI, performance, architecture,
security-policy or historical migration changes are in this correction.

Actual native lifecycle run34963346302/job104361913787 fails both historical
error/cleanup tests with FileNotFoundError for the selector's foundation output.
The newly integrated timestamp preparation calls subprocess.run to execute the
exact existing selector, but execute_fixture replaces the shared subprocess.run
with a Docker/CLI fake. It returns success without executing that selector.

Compile the real514-source/522-unit plan before installing the existing mock.
Only the diagnostic fixture reuses this retained plan. Its deliberate foundation
failure still traverses the real catch path, redaction and resource cleanup.
Production code, all assertions, source pins, native gates, reference and types
are unchanged. This does not certify timestamp SQL or the complete replay.

## Fresh verification

- canonical-native-ledger-regression.py: reproduced2 errors before fix;8 PASS after.
- test-canonical-native-timestamp-sources.py:12 PASS with real source compilation.
- canonical-native-supabase-lifecycle-selftest.py:15 PASS.
- canonical-native-bootstrap-contract-selftest.py:14 PASS.
- git diff --check: PASS.

Current native clean104361913858/run34963346262 and older clean104354284197
were still in progress when inspected. Auth remains preserved; no production
mutation, deployment, main merge or schema/type acceptance is claimed.

Independent scoped code review: no findings. Reviewed actual failure/catch/privacy/cleanup path; production preflight and every assertion retained.
