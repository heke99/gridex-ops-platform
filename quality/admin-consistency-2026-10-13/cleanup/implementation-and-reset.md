# Authorized remediation and reset — 2026-10-13

## Current completed live outcome

Root confirmed the guarded customer-flow reset completed: **743 rows removed**,
with **140 previously empty customer-flow tables** and **all 17 reviewed scoped
rowsets** verified empty afterwards. Applications, quality findings/alerts,
approved event/outbox scopes, customer-derived read models and the classified
inbound pair all completed. The first six forward migrations were applied,
including the manual-email source anchor after the pair reset. See
`final-root-reset-receipt.json`; this preparer performed no live writes.

Companies, users, roles, integration/Ediel configuration, immutable administrative
audit/usage, technical proof and unrelated transports were preserved. Earlier
failed/reset-pending preparation notes below are chronological evidence; their
status is superseded by this completed root receipt. The DQI expansion is live;
retirement of legacy conflict constraints remains tied to application rollout.
Root subsequently confirmed both the seventh portal-source consistency and
eighth consumption-forecast source-guard migrations applied and captured. The
current forward migration count is eight; their bounded verification is recorded
separately from the historical reset preparation.

The earlier README records the initial read-only audit. The user subsequently
authorized removal of all customer-flow applications and operational residue,
and prevention of recurrence through central definitions. The previous
application-provenance limitation therefore no longer blocks this specific reset.
Root alone executes live changes. No global memory or Ediel configuration changes
are part of this workstream.

## Central definitions and ownership

`gridex_data_quality_rule_catalog_v` is the authoritative database registry of
managed rules, entity classes, active-source requirements, window scope, scanner
ownership and aggregate alert mapping. `lib/analytics/dataQualityRules.ts` mirrors
the typed application contract; a behavioral database test checks parity.
`gridex_actionable_data_quality_issues_v` applies the same company/source/active/
period conditions for dashboard and analysis reads. Root updates their consumers.

`gridex_missing_metering_points_v1(company,month)` is the shared uncapped,
same-company active-source predicate for the scanner and selected-month
company/grid-owner statistics. It tests value existence within the UTC month and
returns each point's actual grid owner; a company total must not be copied into
every owner. `gridex_current_point_forecasts_v1(company,month)` selects the latest
completed same-company consumption forecast for each point/month. Historical,
running and wrongly attributed runs cannot override its current evidence.
Canonical negative-value detection uses `coalesce(value_kwh,quantity_kwh)`.
Incomplete numerical evidence preserves an existing issue; it is not a healthy
evaluation. Forecast read errors, including missing relation/column/schema-cache
failures, propagate before any healthy basis resolution.

The scanner executes one service-only, company-scoped database transaction over
the complete source relation, with no 5000/500-row caps. It resolves only managed
rules and the precise month/entity scope evaluated by that successful scan.
Unknown/manual issues are retained. Read/query/write failures roll back all issue
and alert changes. Five source-deletion statement triggers resolve managed
findings and reconcile aggregate alerts once per company batch. A private revoked
primitive supports owner-maintenance triggers without exposing a JWT bypass.

Managed issue and alert provenance is `gridex_data_quality`. Generated nullable
`open_key` uniqueness gives one open logical row, including null aggregate entity
fields. Resolved histories have null keys and are retained through repeated
reopen/resolve cycles. Untagged legacy/manual rows are left untouched by the
migration. Bidding-zone and forecast producers use the shared writer; all four
healthy forecast returns resolve only their evaluated month.

## Reset boundary

“All customer flows empty” means zero customers, sites, meters, contracts,
applications, customer intake/onboarding/workflow/request jobs and operational
read models, plus removal of the specifically reviewed customer event/outbox
rowsets. It does not mean every table is empty.

`reset-approved-scopes.json` contains 17 reviewed rowsets. The root's scoped
baseline pins counts and aggregate row fingerprints without storing identifiers,
messages or payload values. `prepare-reset.py` produces the concrete
`reset-customer-flow.sql` without connecting to a database.

The script preserves companies, users, roles, API/integration configuration,
immutable administrative audit and usage evidence, actor/Ediel technical proof,
password-reset/company-invite mail, publication/product events, platform market
prices and geodata. It selects only the approved tenant energy event types,
approved customer domain aggregate types and their exact outbox children.
Ambiguous sent manual-email and communication-log rows remain held for the root's
classification. Technical event producers may continue appending unrelated rows.

The transaction locks operational roots, checks 140 previously empty graph tables,
locks/captures exact reviewed row IDs, compares counts/fingerprints, deletes
children before parents and rechecks all scoped/owned remnants. Existing FKs and
triggers remain enabled. Preserved rowset hashes catch unintended FK SET NULL or
CASCADE effects and roll back the entire reset. Nothing dynamically discovered
outside the reviewed scopes is automatically deleted.

## Historical apply-order preparation

Reset precedes the DQI migration because added columns change full-row hashes.
The final migration drops legacy five-column `UNIQUE(...status)` constraints.
Old deployed clients still use those plain onConflict targets and would fail
42P10 after that cutover. Prepare the new functions before the code deployment,
verify the RPC-based app, and coordinate the final constraint cutover; do not
leave old application code running against the final removed keys. Root owns
live execution and deployment coordination.

## Verification

- Real migration executed against production-shaped PGlite issue/alert DDL and
  source relations; behavioral tests cover tenant/provenance, failure atomicity,
  over-5000 source completeness, period/point scopes, null aggregates, repeated
  histories, source deletion and unknown/manual preservation.
- Expansion with legacy keys retained, followed by two full migration replays,
  passed. Current-source regressions first reproduced canonical-negative and
  historical-forecast failures, then passed after the fixes. The targeted suite
  passed 31/31 tests on 2026-10-13 at 10:42 UTC, including canonical producer
  precedence. Independent reviewer proofs also passed the actual open → resolved
  forecast-history transition and canonical-negative preservation.
- Forecast producer tests exercise all four successful evidence paths, missing
  basis and read failures, using the real forecast function.
- The real reset SQL template passed eight PGlite scenarios at 10:59 UTC:
  successful child-first
  reset with preserved technical/admin proof, stale application baseline, new
  customer, an FK SET NULL that would damage a preserved technical row, changed
  inbound classification, a new classified manual/event pair, an Ediel source-ID
  collision, and a trigger mutating a NULL-classified technical row. The fixture
  contains the narrowed inbound source relationship and unrelated retained rows.
  Targeted reset-test lint passed.
- Full app typecheck and targeted lint passed on the final owned source;
  root performs final full-project verification and native/live checks.

PGlite calls queued concurrently demonstrate repeated request deduplication, not
native multi-connection concurrency. Database uniqueness plus the company
advisory transaction lock provide the actual concurrency mechanism; live
multi-connection verification remains a root check. This agent performed no live
writes and does not claim that the live reset/deployment has happened.

## Narrowed inbound review and execution limitation

Automatic approval review rejected the earlier broad inbound clear after a
volatile fingerprint refresh because the refreshed hash did not establish
customer provenance. Root then verified the exact unmatched manual case/email
event relationship, power-of-attorney intent, absent customer/site/meter/object
targets and absence of an Ediel source match. The actual reset now selects only
that reviewed relationship and preserves unrelated inbound rows.

The reviewer confirmed that `NOT(predicate)` omitted SQL-NULL classifications
from preservation hashes. A local trigger proof demonstrated an unnoticed
mutation of an unknown technical energy row. Root changed both preservation
capture and saved predicates to `NOT COALESCE(predicate,false)`; the repository
behavioral test now verifies complete rollback on that mutation.

At this handoff, root reported that two attempts with the reviewed full reset
returned `Invalid/expired requestState` and committed nothing. This is a tool
approval-state limitation, not evidence of a successful reset. Root owns any
fresh guarded execution and subsequent live verification. The local eight-case
pass does not establish live reset completion.

## Focused continuation after the application receipt

Root subsequently completed the focused application reset under a customer-empty
guard, locked single-application count/hash and a final remaining-count check.
`application-reset-receipt.json` records this root-confirmed 1 → 0 outcome.
Only that scope's policy/count/hash changed to zero and the deterministic empty
fingerprint. `reset-approved-baseline-before-application-reset.json` preserves the
previous reviewed baseline. No other volatile fingerprint was silently refreshed.

`prepare-focused-resets.py` renders four shorter transactions without connecting
to a database. Execute C (approved customer events and their outbox children),
then B (customer read models/quotes/resolution/onboarding), then A (reviewed
quality findings/alerts), then D (the classified unmatched inbound pair).
Deleting event children before their roots protects reviewed event fingerprints
from FK SET NULL effects. Every batch locks customer/site/meter/application roots
empty, validates selected counts/hashes, captures UUIDs, deletes only those UUIDs
with FKs/triggers enabled, verifies scope and UUID emptiness, and checks unchanged
NULL-safe technical/admin rowsets. Shared event tables receive row locks for the
selected rowset while unrelated technical producers continue.

Four actual focused-SQL PGlite cases passed at 11:13 UTC: C → B → A → D success
with technical/admin preservation; changed event-parent baseline rollback;
unknown technical FK SET NULL rollback; and an inbound Ediel-source collision
refusal. The test reads the generated SQL, substituting only fixture counts/hashes.
Focused test lint passed. The independent final read-only verification checks all
140 originally empty graph tables and all 17 reviewed scopes; root alone executes
that live check. These local results establish batch guards, not execution of
the remaining live batches. D may require a fresh explicitly classified count-1
baseline and receipt immediately before its live attempt.

## Static continuation and current receipts

The focused C attempt also returned `Invalid/expired requestState` without a
commit. Root then executed a smaller static quality transaction through the same
`execute_sql` tool: reviewed findings 18 → 0 and alerts 350 → 0, after verifying
no incoming FKs or DELETE triggers and guarding the reviewed count/hash under a
customer-empty lock. `quality-reset-receipt.json` records that root-confirmed
outcome. Old A scripts remain historical and must not be executed again.

`reset-static-plan.json` supersedes the earlier dynamic/full reset plans. Five C
statements precede seven B statements; D remains one paired transaction after
the fresh classification check. Every generated statement has explicit table
names and static SELECT/DELETE, no dynamic SQL or SQL/JSON loops. Count/hash and
locked selected UUIDs bound every deletion. Fingerprints over all nonselected
UUIDs preserve NULL/unknown classifications without relying on changing semantic
joins. Relevant FK child tables either remain empty or retain complete-row
fingerprints. Unexpected referencing tables or new DELETE triggers refuse the
transaction; FKs and triggers remain enabled.

The preparer made two read-only live catalog queries for the fourteen C/B/D
targets. Seventeen incoming FKs and zero noninternal DELETE triggers were found;
the exact FK catalog is saved in `static-reset-live-fk-catalog.json`. These reads
did not change live data. The narrower preservation guards follow the verified
graph; direct delete targets cannot affect unrelated admin/configuration tables
through a verified nonexistent incoming FK or DELETE-trigger path.

Four actual static-SQL cases passed at 11:30 UTC: C1–C5 → B1–B7 → D succeeded
with the final 140-table/17-scope assertion; a new FK child caused refusal;
quote deletion that would SET NULL on an unknown technical event rolled back;
and a classified inbound source matching Ediel proof caused refusal. Fixture
substitution changes only reviewed counts/hashes. No static C/B/D live execution
is claimed by these local tests. Root retains live execution and final receipts.
