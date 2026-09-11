# Operational repair classification — 2026-09-06

Status: two bounded input dispositions verified; full replay and production parity
remain open. No historical repair was executed and no production data was changed.

## DB2B reviewed disposition — 2026-09-06

`02_db2b_apply_superadmin_and_membership.sql` is an explicit, fixed-identity
administrator/membership repair, not a reusable schema migration. Its entire DO
body selects the specified company, inserts/updates that administrator and company
membership, and records backfill/audit rows. It contains no DDL, generic role seed,
dynamic SQL, customer creation, or application function invocation. Historical
identity values are deliberately not reproduced in this report.

The relevant repository trigger bodies were reviewed directly:

- `gridex_audit_admin_users_change` inserts administrator audit records.
- `gridex_normalize_audit_context_v1` normalizes the incoming audit row only.
- `guard_last_functioning_tenant_admin` reads membership/auth/profile state and
  rejects removal of the final functioning administrator; it creates no schema
  or reference data.

The exact source and the three immutable source files containing those bodies
are pinned independently in both the selector and static provenance validator.
The JSON classification must repeat the same dependency set. Missing dependencies,
changed bytes, changed pins, or another path fail validation. This finite review
is not a general SQL-effects parser, and does not certify arbitrary later trigger
implementations. Schema-bearing dependency files retain their own classifications.

The distinct status `historical_operational_data_repair` means these operational
identity/audit writes are not canonical seed data. It makes no assertion about
whether the historical repair was deployed, and does not authorize re-execution.
The original SQL remains immutable in Git; it must not provision a historical
administrator whenever an empty database is reconstructed.

## DB2 execution disposition — 2026-09-11 (Task24)

Only `migrations/02_db2_execute_controlled_reconciliation.sql` (31 lines,
SHA256 `fcdc75e660f157a58e742f64b3e8f7a1c6801565ef16023bd0c9a317982744c9`)
now shares the finite `historical_operational_data_repair` contract. The complete
Task23 map in `DB2_CONTROLLED_RECONCILIATION_SOURCE_EFFECTS_2026-09-11.md`
and the exact called bodies establish these operational effects:

- `02:8-31` asserts readiness, updates repair-run metadata, calls both apply
  engines, and reads diagnostics. Membership-candidate evaluation also reaches
  the sole-company helper, which can insert ambiguity findings.
- DB2 `01:645-1001` inserts/updates memberships, fills profile company IDs,
  creates/updates customers and canonical links, and records items/audits.
  DB1 start/finish helpers upsert/reset and finish operational backfill runs;
  email normalization and source hashing create no persistent objects. The
  timestamped DB1 duplicate helper definitions are pinned independently too.
- The customer insert trigger calls `gridex_next_customer_number` when a usable
  supplied number is absent, inserting/updating `company_customer_number_sequences`.
  The update trigger enforces existing customer-number permanence. These are
  operational allocations and guards, not schema or reference seeds.
- Partner-origin customer metadata conditionally reaches
  `private.gridex_partner_customer_event_v2` and its emitter: `domain_events`
  and matching active subscriptions' queued `webhook_deliveries` can be inserted.
  Profile metadata wins on insert and can select that route. Missing references
  or nonmatching subscriptions suppress some effects. No delivery/provider call
  occurs inside these functions.
- Membership updates/upserts can invoke the last-functioning-admin guard, which
  reads auth/profile state and may reject a downgrade. Customer audit writes
  invoke audit-context normalization, including request/correlation IDs and the
  unspecified system-actor label. Neither creates schema or reference seeds.

Company and invitation normalization are top-level statements of DB2 `01` and
are not reached by executing `02`; their legal-profile/publication and invitation
trigger trees are outside this disposition. The customer process-summary update
trigger watches fields that DB2 does not assign. No new operator workflow or
application grant follows from this source classification.

All nine ordered dependency paths and SHA256 values are hard-coded independently
in the Python selector and JS provenance validator and repeated in the JSON
classification. Fresh hashes match the supplied immutable pins. Source changes,
any dependency pin/byte drift, removed/extra/reordered dependencies, unknown
source paths, and execution/substitution overlap fail closed. The prior DB2B
entry is unchanged. This finite source review makes no deployment-history,
historical execution, runtime trigger-presence, safety, or production-parity claim.

The four schema-bearing DB2 companions (`01`, `01B`, `03`, `03B`) and
`20260522_db1_schema_repair_backfill_foundation.sql` remain `UNCLASSIFIED`, with
no selected execution or derived artifact. Complete schema/native replay,
remaining source effects, generated types, ledger and live parity remain open.

## Task24 verification — 2026-09-11

- The new positive test first failed independently in the real Python selector
  and JS provenance validator on the unreviewed DB2 path. Adversarial overlap
  cases also demonstrated the legacy-source gap before its narrow correction.
- `python3 scripts/gridex-replay-input-accounting-selftest.py`: 38 tests PASS,
  including nine DB2 tests covering both actual validators and every dependency.
- Review correction I1: both validators now reject an excluded path selected
  directly as an interleaved artifact, as well as foundation paths and selected
  derived sources. The new direct-interleaved case failed in both actual
  validators before the fix; it and the interleaved-derived-source case pass
  afterward. Outer accounting already blocked that overlap, so this corrects
  independent validator completeness without claiming a full-replay bypass.
- Accounting and focused review-group generators derive 600 inputs = 546 selected,
  23 substituted, 26 unclassified, 5 excluded; focused346 = 303/20/18/5.
  Foundation104 and timestamp510 are unchanged. Full-effects accounting exits1
  with 49 unresolved globally (38 focused); no gate was weakened.
- `DB2_OPERATIONAL_EXCLUSION_EVIDENCE_2026-09-11.json` is a generated projection
  of `gridex-replay-input-accounting.py --require-full-effects` and
  `gridex-replay-review-groups.py --group auth_membership_tenant`, retaining the
  exclusion metadata and independent unresolved companion rows. The older auth
  inventory remains historical evidence at its recorded `sourceCodeBase`.

## Historical DB2B verification — 2026-09-06

- `python3 scripts/gridex-replay-input-accounting-selftest.py`: 28 tests PASS,
  including valid finite disposition, independent unresolved inputs, changed SQL
  despite refreshed JSON, unknown paths, missing/changed dependency pins and bytes.
- `python3 scripts/gridex-aud-003-clean-replay-selftest.py`: 14 tests PASS.
- `node scripts/gridex-aud-003-migration-provenance-regression.cjs`: PASS.
- Actual input accounting remains blocking: 587 files, 497 full-file selections,
  31 unresolved substitutions, 4 explicit exclusions and 55 unclassified inputs.

These checks establish input classification only, not successful execution,
schema survival, ledger provenance or production parity. No phase is closed.
