# Baseline rollback private SQL diagnosis — 2026-10-01

Actual seventh OPS run36809457517 upgrade job110201031039 restored the separate fresh pinned ae56ee0a old database and passed its complete old catalog gate at03:17:57.863Z. Its next old-schema proof failed at03:17:57.935Z with SQL_FAILED_PRIVATE_CONTEXT. Private cleanup removed the original SQL cause; the reason is unavailable, and this change does not invent or repair that cause.

The existing exact Bash SQL wrapper now requests psql SQLSTATE-only verbosity and projects one strictly parsed five-character error state, a fixed proof label and the last known fixed proof stage. Missing, malformed, ambiguous and success00000 states produce only unknown. A libpq fallback primary message, private filename, database URL, raw SQL, JWT, key, context, row or exception excerpt is never printed. Actual SQLSTATE and the specific assertion cause remain unconfirmed until a genuine new native run. Five fixed client markers precede the unchanged old shape, authenticated, anonymous, command and revocation proof blocks.

ON_ERROR_STOP, nonzero failure, private logs/cleanup, pinned653 historical SQL, strict old data/owner/ACL/full-catalog gates and all old command/RLS/replay assertions remain. No production grants, privileges, low-role behavior or historical SQL is changed. This is instrumentation for the actual existing owned disposable proof, not a new older general PRODAT exercise. Old contact v1 has no sessionId interface; this old proof does not qualify newer current-session semantics.

The executed actual wrapper tests control only the external psql process. Before the change six diagnostic assertions failed and the unchanged success-control passed. Afterwards all seven pass, and the full existing source/Bash/actual installed PostgreSQL-core suite passes **27/27**. These overlap the prior20 cases; there are seven new diagnostic cases. Bash syntax passes. They verify the actual wrapper's failure exit, strict SQLSTATE/stage projection, success-only original PASS filter and private canaries. They are not a real psql/Supabase/archive/RLS success receipt.

Commands: Node22 with NODE_PATH=/tmp/ediel-service-check/node_modules, `node --test scripts/tenantservice-baseline-rollback-20261001.test.cjs`; `bash -n scripts/tenantservice-baseline-rollback-20261001.sh`. Local logs are private scratch `/tmp/gridex-baseline-diagnostic-red.log` and `-green.log`; native remains pending until the next published source runs.

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `scripts/tenantservice-baseline-rollback-20261001.sh` | `bf9d63db201f7eeea3275390f42d230c573b1ce0` | `f2fe2eff04a0f1879d6511854977df9dda63a24b220428cf2cf35f8e9440cf02` |
| `scripts/tenantservice-baseline-rollback-20261001.test.cjs` | `74832bc00c19f8abd075604dab4ce59e3244a93f` | `ed5a77db2c437c9ca8eda764d3a0ee279e99d2129d46e98b1379ccf89d520593` |
