# PR310 native session ACL transport qualification

Date: 2026-09-15. Scope: a bounded native fixture transport adjustment; no historical SQL, function definition, role grant, migration authority, ledger entry or reference schema changes.

## Evidence and cause hypothesis

The actual dc0 short native preflight completed the unchanged session setup and behavioral matrix, then failed at LIVE_SYNC_ACL_ANON: expected INSUFFICIENT_PRIVILEGE, no recognized primary SQLSTATE, nonzero client exit, SERVER_CONNECTION_CLOSED. Cleanup's separate clone-identity query observed DATABASE_RECOVERY. This establishes a native server/connection failure instead of the required denial. It does not itself establish a stack trace or SIGSEGV. The subsequent 437 short run did not execute this SQL because its earlier CLI transport selftest still rejected the sixth admitted forward; the parent corrected that separate test.

Independently fetched upstream [supabase/postgres issue 2409](https://github.com/supabase/postgres/issues/2409), [issue 2366](https://github.com/supabase/postgres/issues/2366), and [issue 2377](https://github.com/supabase/postgres/issues/2377). The reports describe a regression in image 17.6.1.106: a function EXECUTE denial after a superuser login changes role can crash the backend; an actual non-superuser authenticator login followed by the same role switch returns the expected 42501. Table permission denials have a different reported outcome. This closely matches the finite dc0 evidence and justifies the narrowly scoped login-path change. It is reported upstream behavior, not a new local reproduction or a claim about every image.

## Exact adjustment

`NativeTimestampTarget.sql` changes the login only for these three exact source-fixture requests:

| Stage | Fixed role in unchanged SET LOCAL ROLE | Required SQLSTATE |
| --- | --- | --- |
| live_sync_acl_anon | anon | 42501 |
| live_sync_acl_authenticated | authenticated | 00000 |
| live_sync_acl_service_role | service_role | 00000 |

Admission also requires the exact complete fixture SQL string, transaction=False, the owned `gridex_auth_legacy_helper` clone with unchanged OID, and the original complete `canonical-live-sync-proof.py` SHA256 `fd58be14dfc5409a65f3e5d4d3d0d8b9073347a0f4a676839bf770d38cbc89ca`. Unknown stage, changed body, changed role, wrong database, different expected result or changed source fails closed. Ordinary setup, behavioral matrix, snapshots, migration work and other SQL still use their existing login paths.

The fixed psql command uses `-U authenticator -h /var/run/postgresql -w` inside the already verified owned database container. There is no arbitrary login/host argument, external URL, password injection, role creation/alteration, new GRANT, or SET SESSION AUTHORIZATION. Before each unchanged ACL request, a separate read-only query using the exact same connection arguments verifies session_user=current_user=authenticator, LOGIN=true, SUPERUSER=false, BYPASSRLS=false and permission to SET ROLE to all three API roles. PostgreSQL 17 documents [pg_has_role(...,'SET')](https://www.postgresql.org/docs/17/functions-info.html) as the ability to switch to the requested role; mere membership is not substituted for it.

The fixed login query is 406 UTF-8 bytes, SHA256 `c87ac861563ab2b4975930b6da19ab5dd3967d74e683144cabaa36489e8a0c2a`. It reads only fixed role attributes and three booleans; no role inventory, password, customer row or arbitrary SQL result is published. Responses must exactly match the closed expected object and boolean types. Existing private command streams and finite diagnostics remain in force. The subsequent ACL payload is byte-for-byte unchanged, and the exact primary SQLSTATE/exit rejection remains unchanged.

## Receipts and preservation gates

A role receipt is written only after that role's real login check and exact SQLSTATE check succeed. A new attempt clears its prior receipt first. Admission requires exactly anon/authenticated/service_role keys, fixed authenticator login, exact expected SQLSTATE, successful verification flags, and hashes of the complete fixture source, exact role-specific SQL bytes and fixed login query; missing, changed or extra data is rejected.

The short preflight admits all three receipts only after the existing unchanged parent catalog/rows/provider/ledger comparisons and source reread. It publishes them as `apiLoginAclQualification` only after owned clone disposal succeeds. The full native session wrapper clears receipts at entry and publishes under sessionReconstruction only after the existing source boundary returns with nativeBoundaryVerified=true and all four proof clones have been disposed. That existing boundary verifies the actual CLI application receipt, exact function postimage and retained ACL; no older ledger identity or historic execution is fabricated.

## Verification and current boundary

35 timestamp-proof tests and five short-preflight tests pass. New controls cover the exact payload produced by the unchanged behavior function, command login/socket arguments, wrong session/current identity, superuser/BYPASS/NOLOGIN, missing SET right to any API role, stage/body/database/result/source mutations, strict failure handling, stale receipt removal, altered/missing/extra receipt bindings, parent state/ledger preservation and cleanup-before-publication. The initial adapter and receipt-admission tests failed before implementation, then passed.

Actual PostgreSQL execution of this authenticator path is pending the next ordinary native short preflight. This report does not claim that the image regression is fixed, that the complete native 144+514 replay passed, or that application/schema/type acceptance is achieved.
