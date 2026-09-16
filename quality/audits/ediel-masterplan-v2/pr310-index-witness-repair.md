# PR310 index witness repair — 2026-09-16

Scope: the existing five-index test only; no application/index/migration or
permission definition is changed. Required release gates remain enforced.

## Observed defect

The owned full portable replay of commit767966d3 in run35091721140 executes the
144 foundation,514 timestamp and12 registered forward sources and now passes the
previously failing removed-policy RPC metadata guard. It also passes the added
and changed views and24 changed-function behaviors. It stops in the index witness
with a deliberately redacted unclassified failure, before final schema capture.
Artifact10444891002 ZIP SHA256:
`beb3f87b187dc210907de18b9ea9fafa92901f7c084ef294ab61dff154cfab4e`.

An isolated network-disabled PostgreSQL17 fixture reproduced two distinct harness
errors in run35092774599 (artifact10444434726, ZIP SHA256
`e0d955d20759a9ce63a87e0ddd1bd9429747692702661f8fb73c2a7b2c854b98`):

1. The unparenthesized CASE expression inside IF terminates at its inner THEN,
   producing SQLSTATE42601. Parenthesizing that expression reaches all12 existing
   uniqueness/predicate cases with zero SQL errors; the oracle is unchanged.
2. All five temporary witness definitions then normalize to NULL. PostgreSQL17
   ruleutils.c uses get_namespace_name_or_temp for a qualified relation name, so
   the current temporary schema deparses as pg_temp, not physical pg_temp_N.
   The old exact-prefix formatter incorrectly used pg_namespace.nspname.

## Correction and rejection boundaries

Parenthesize the CASE. Build the expected deparser prefix using pg_temp only when
its namespace OID equals pg_my_temp_schema(). Keep the exact prefix equality,
full remaining index text, five original source hashes, full catalog row hashes,
unique/nonunique modes and valid/ready/live flags unchanged. No regex/global SQL
normalization, name-only comparison or accepted-reference rewrite is introduced.

Expose only eight fixed CHANGED_INDEX_WITNESS_* error constants in the parent's
failure category. Unknown messages, non-ValueError exceptions and extra arguments
remain redacted. Failure still leaves the tail failed and runs owned cleanup.

Unit regressions first failed on both renderer defects and on missing index
failure categories, then pass after correction. Actual full-source SQL execution,
native ledger, schema decisions, type generation and final CI still require their
own completed results. This evidence note does not claim those gates passed.
