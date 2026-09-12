# Complete auth-email source — test first

## Auth-email source restored — 2026-09-06

Complete auth-email source and profile normalization passed PostgreSQL17 job
101547966634, OPS 34056026728, code head b98c0d079b6846ad5f2098da598bf1d72bae31dc.
Original source is now selected after the profile bootstrap and before profile
normalization. Selection failed SUBSTITUTED before the fix; now passes, while
reversing auth/normalization order is rejected. Profile regression updated for
the verified combined order and passes. 29 accounting tests, static provenance
and integrity pass. Counts: 504 full, 28 partial, 51 unknown, four exclusions.
Hosted restoration-head validation pending. No production writes, schema/type
hash edits or phase closure. Continue historical effect accounting before full
canonical replay, generated artifacts and ledger/live parity.

Source 20260519_auth_callback_email_reset_sync.sql is partially substituted by
20260519_user_profiles_foundation. Full review identifies omitted auth_email_events
DDL, two auth-user FKs, action/status checks, three indexes, service-role RLS and
an INSERT/ON CONFLICT profile backfill from auth.users. Existing profile email is
preserved when nonnull; confirmation/sign-in metadata and sync timestamps update.

The entire original source must execute before the restored profile-normalization
source, because it reinstates the older action enumeration. No selection change
is made until complete PostgreSQL17 execution passes. Test uses actual auth.role()
claim semantics, pgcrypto, a scoped auth.users fixture and synthetic users/events;
no production access. It runs the whole auth source twice, then the whole metadata
normalization twice, checking existing identity/status preservation, missing profile
creation, confirmation fallback, event preservation, constraints, FKs, indexes,
RLS and non-owner reads. This is not full canonical or actual JWT/provider E2E.

Local SQL composition and diff checks pass. PostgreSQL execution pending CI.
No original SQL/hash, generated artifact, production DB or replay gate changed.
