# PR310 bounded column dispositions — 2026-09-15

Status: PARTIAL; no schema/reference/type acceptance. Read-only source and
application review, with direct reconstruction of observed catalog-row hashes.
No historical SQL, reference, generated types or production data changed.

## Evidence

Fresh full-schema comparison335f987f/run34963346325/artifact10394485748 executes
144 foundation and514 timestamp inputs on its existing portable target. ZIP
SHA2564009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb verified.
Its public reference/replay hashes exactly match earlier artifact10371643836.
This proves comparable deltas, not native migration history or release readiness.

The changed columns include723 differences in physical ordinal only and18 with
other field differences. This bounded review concerns only four changed types.
All eight reference/replay row hashes were independently reconstructed using
scripts/sql/gridex-db-parity-introspect.sql fields and the canonical sorted JSON
SHA256 algorithm. Identity/generated fields are empty for all four columns.

| Column | Reference | Replay | Disposition |
| --- | --- | --- | --- |
| customers.intake_missing_fields | ordinal40, text[], NOT NULL, '{}'::text[] | ordinal31, jsonb, NOT NULL, '[]'::jsonb | Unresolved source contract conflict; app failure unproved |
| customers.intake_warnings | ordinal42, text[], NOT NULL, '{}'::text[] | ordinal36, jsonb, NOT NULL, '[]'::jsonb | Same |
| ediel_send_locks.locked_by | ordinal6, nullable text, no default | ordinal6, nullable uuid, no default | Preserve authored actor identity; do not widen blindly |
| integration_api_requests.ip_address | ordinal9, nullable text, no default | ordinal9, nullable inet, no default | Compatible with validated IP/null writes; full SQL qualification separate |

## Source and application paths

Intake JSONB comes from20260521_batch_customer_intake_debug_hardening.sql and
20260521_batch_customer_intake_batch2_hardening.sql. Later May26/June10 sources,
including20260610171000_customer_application_status_hardening.sql, declare
text[] through ADD COLUMN IF NOT EXISTS; those declarations do not convert an
existing column. applicationReview.ts builds string arrays; both
lib/website/customerApplicationShared.ts and
app/admin/website-applications/actions.ts send those arrays. Customer readers
use unknown for the returned fields. No relevant SQL array cast/operator was
found. Payload compatibility defeats a claimed present app regression, but does
not resolve the conflicting database contract. Any future text[] convergence
requires a reviewed forward migration with lossless ordered conversion and
rejection of non-array/non-string JSON, preserving defaults/nullability and
proving actual PostgreSQL/PostgREST behavior. No such migration is accepted here.

The original20260601070000_ediel_production_readiness_hardening.sql explicitly
creates UUID locked_by REFERENCES auth.users(id) ON DELETE SET NULL. Its reviewed
residual ordering precedes20260602090000_ediel_operations_platform_core.sql,
whose text declaration is conditional. Existing
canonical-residual-readiness-native.py tests identity preservation and23503 for
an unknown actor. canonical_transition_ediel_production accepts and writes a
UUID actor; app callers pass actor IDs. Widening to text would discard authored
identity integrity and is not justified by the old reference.

IP inet originates in20260531111600_system_readiness_foundation.sql. The later
20260609113000 declaration is CREATE TABLE IF NOT EXISTS, not type conversion.
lib/integrations/apiAuth.ts uses trustedClientIp; integrations/ipPolicy.ts
normalizes and validates through Node isIP and returns IPv4/IPv6 or null.
Unvalidated arbitrary text is not written by that path. Text widening is not
justified by this review.

## Remaining gates

These findings are qualifications, not a blanket difference allowlist. Preserve
the committed reference. Complete native514 execution, all remaining column/
index/policy/privilege/source-effect comparisons, deliberate FK forward repair,
genuine type generation and final same-head CI/E2E/review remain required.
The root re-ran the complete first verify step after continuity repair: inventory,
recovery20, required-checks12, complete-document rejection, input-accounting38,
review-group16, auth-membership continuity and production-readiness all PASS.
Derived inventory artifacts emitted by that test were discarded, not accepted
as a database migration log.
