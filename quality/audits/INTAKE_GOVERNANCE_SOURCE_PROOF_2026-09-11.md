# Complete intake/governance source proof

Status: IMPLEMENTED_NOT_VERIFIED. Standalone native gate pending; source
selection unchanged. Current masterplan status is `.agent-memory/current-state.md`.

## Scope and provenance

All 332 original lines were read and independently reviewed. Original files
and historical manifest bytes remain unchanged.

| Key | Original under `supabase/migrations/` | Lines | SHA256 |
| --- | --- | ---: | --- |
| R | `20260513_ediel_agt_saas_runtime_safe.sql` | 163 | `152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b` |
| D | `20260520_company_delete_backfill_and_admin_layout.sql` | 97 | `72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f` |
| I | `20260521_batch_customer_intake_debug_hardening.sql` | 72 | `562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80` |

First74 provides every mandatory prerequisite. The optional
`ediel_tgt_dynamic_test_data` relation is absent and R explicitly skips it.
First1/2 supply core operational relations; first7 email company ownership;
first16/19 intake requests/cases including `source`; first22/23 Ediel tests;
first31 governance metadata; first70 test-message company ownership.

## Source effects and limitations

| Source | Expected normal catalog delta | Complete row model |
| --- | --- | --- |
| R | Six indexes; four column comments | Identity at first74; new company columns would be nullable. No tenant backfill. |
| D | Three indexes; four replaced validated status CHECKs | Normalize allowed NULL statuses; delete orphan memberships/invitations; detach orphan governance/audit ownership. |
| I | Three columns; two NOT VALID CHECKs; six indexes | Add intake defaults only where columns were absent; preserve all existing values and other fields. |

Total expected normal delta: 15 indexes, three columns, two added CHECKs, four
replaced CHECKs and four comment effects. The native baseline probe asserts
new index/column/constraint counts in addition to full catalog equality.

D validates CHECKs before row normalization or orphan deletion. Invalid
non-null companies, blank memberships/invitations and other excluded values
therefore fail23514. It removes previously admitted invitation states
`sending`, `sent`, `delivery_uncertain`, `invited`, `failed` and email-event
`completed`. These are characterized historical behaviors requiring later
canonical reconciliation, not authorization to discard production rows.

R preserves first73's three-column `ediel_messages_company_family_status_idx`
despite declaring a four-column variant. I preserves first32 personal/org
number indexes without partial predicates. IF NOT EXISTS does not replace
their definitions. Native full catalog/probes retain these exact variants.

I's guard tests only table-local constraint name. Same-name definitions and
validation flags remain unchanged; unrelated-table names do not suppress the
new constraints. NOT VALID admits historical invalid rows but enforces future
inserts/updates. The suite checks postapply score boundaries and status writes.

Existing FKs normally prevent orphan company metadata. Private fixture-only
FK removal creates explicit orphan preimages; the entire resulting fixture
catalog is preserved except for reviewed source effects. Governance jsonb
concatenation overrides object keys, appends an object to arrays/scalars, and
converts JSON null to `[null, marker]`. First74 metadata is NOT NULL. A nullable
ambiguous null row is rejected by the independent model rather than guessed
to be SQL NULL. No timestamp trigger applies to D's changed tables at first74.

These sources add no policies, grants, functions or triggers and do not replace
existing FK delete actions. R's nullable company columns alone do not establish
tenant isolation.

## Private proof boundary

The standalone proof admits only an owned SUCCEEDED readiness74 handle with
closed AcceptedInputs and the complete linked fixed/alignment/operations/
readiness reference, run and release chain. Every query, clone and drop checks
that chain again. Both upstream RUN identities are frozen, not merely their
dataclass values. A reviewer-reproduced same-valued RUN replacement regression
was observed RED and corrected GREEN using real closed-chain validation.

The proof reuses accepted private PIPE transport, full catalog/comments and
row/sequence projection, canary checks and exact clone cleanup. A fresh private
native clone receives the fixture. A second owned clone copies that exact
preimage, including fixture clocks/defaults, before independent source-only DDL
is evaluated. Native execution uses all original source bytes in order, in one
transaction. Expected full rows come from the independent Python model.

Every successful case requires full precommit and postcommit catalog/row
equality, with only the previously reviewed source-new-index HOT comparison.
Errors require exact SQLSTATE and full rollback. Original database, canary,
source bytes, private collector and owned cleanup are checked.

## Verification

- Eight local constructors PASS: order/hash/physical ownership, status ordering,
  JSON semantics, default preservation, independent guards, foreign handles,
  prepared-clone failure cleanup, and real frozen predecessor chains.
- Inherited readiness source constructors: ten PASS.
- Standalone 23-case native matrix prepared: baseline/repeat, populated two
  tenants, nullable statuses, three invalid statuses, five formerly allowed
  invitation values, completed email event, all orphan branches, invalid
  historical intake plus future-write enforcement, same/unrelated constraint
  names, optional relation/column guards, required-column failure, and exact
  rollback after each complete R/D/I source.
- Workflow `intake-governance-source-proof` uses isolated owned PG17 and always
  runs exact owned-container cleanup. Local native execution is unavailable.
- Independent final implementation review APPROVED. Actual74 predecessor accepted on53ef8b7,
  OPS34657354694/job103452514584 SUCCESS23:32:15Z. No native acceptance or
  original-child actual77 integration is claimed.

Global accounting remains INPUT_SELECTION_ONLY:600 inputs,555 selected,
23 substituted,17 unclassified,5 excluded.40 globally unresolved,31 focused.
All three candidates remain UNCLASSIFIED until reviewed source proof and
separate original-chain integration. Full replay/schema/types/parity and
production delivery remain open; ADR006 forbids mass historical replay or
ledger marking in production.
