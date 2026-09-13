# Ediel forward correction and reconstruction checkpoint — 2026-09-14

Status: PARTIAL. Implemented and pushed to PR310, NOT merged/deployed.
Native FK and the complete selected SQL chain are verified. Full schema parity,
ordinary native Supabase lifecycle/ledger, generated types and overall release
acceptance remain blocked. Plan points85/86 are NOT marked complete.

## Accepted correction and the first candidate's regression

Registered file:
`supabase/migrations/20260913211625_ediel_intent_customer_company_integrity.sql`

Current SQL SHA256:
`2b9cc5e9cb7fad14aa4b30e0bc98274a4a957f47379f456ed0d3c9663ef5f39b`.
Qualified code: `76dd87ef62a471a49e8f7fbcbadec25425219cc9`.

The original new candidate (da2d3d288d69038b4c9767fe22b2a1ae4293d3196d88b5d129089337594392b9)
was integrated in4f45b185579dddadb702189cc4d0454eb17b58fd after reduced native
fixtures. Full-chain run34787496588 exposed its incorrect precondition that
customers.company_id must be NOT NULL. Both historical replay and a read-only
connected Supabase catalog query confirmed that parent column is nullable.

Commit76dd87 changes only that parent precondition in the unreleased migration.
The original candidate remains hash-locked as a red regression fixture. Historical
migration SQL and original manifest bytes were never changed. No failed
candidate was applied to the connected database or main.

The corrected key is `(customer_id,company_id) REFERENCES customers(id,company_id)
ON UPDATE CASCADE ON DELETE SET NULL (customer_id)`. The intent company stays
NOT NULL; references to another company or to a customer with no assigned company
are rejected. Only an absent key or the exact historical predecessor is admitted.
Transactions, finite locks and native validation preserve rows on failure.

## Native evidence

Run34788070725: Ediel customer FK qualification SUCCESS on76dd87.
Four cases cover API grants on/off and parent company NOT NULL/nullable. Tests
execute both actual immutable historical classification/FK files and reproduce
the old deletion failure and the first candidate's nullable-parent failure.
They verify safe detach, retained company/payload, cross-company and unassigned
parent rejection, child NOT NULL protection, idempotence, unknown predecessor
rejection, dirty-data atomic rollback, and no unrelated catalog/RLS/grant changes.
This differential test does not assert full live-vs-replay schema parity.

Run34788070766/job103807093120: residual-transitions SUCCESS on76dd87, including
complete selected continuation and a second staged lane with original SQL absent.
Foundation144 and timestamp514 finish, including the exact new forward file.

Run34788070766/job103807093005: actual owned shell passes source admission and
selected SQL execution, then stops at the unchanged final schema comparison.
Its final report verifies privacy and disposal. Overall job remains FAILURE;
passing SQL must not be represented as full native Supabase acceptance.

## Inventory correction after adding the forward

Latest test-correction code: `581ed7c09061ce20fce12d820605064d7f19c540`.
Run34788675859/job103808730101 SUCCESS verified exact before/after hashes for
three files: governance, operations-sync and auth-provisioning-diagnostics
self-tests. The lexical auth review inventory changed346->347 and its whole-file
count334->335 solely because the registered forward is a new timestamp input.
Each test now pins its exact path, SHA256, FULL_FILE_SELECTED status and ordinal514.
The historical30/31-file prefixes stay unchanged. Six forward-admission and13
 timestamp tests plus the two historical prefix admissions passed before push.
The full local aggregate auth self-test exceeded its execution limit; no local
aggregate pass is claimed. Mandatory OPS/native fixture reruns are still required.

Overall source accounting:601 files,589 FULL_FILE_SELECTED,2 SUBSTITUTED,
5 UNCLASSIFIED and5 EXPLICITLY_EXCLUDED. The seven unresolved legacy-selector
items have separate strict residual contracts; their labels were not suppressed.
Five explicit exclusions and all private0600 checks remain unchanged.

## Connected-database read-only preflight

Project gridex-ops-dev (piidsfebjqjmnepdpnas), PostgreSQL17.6:
279 real migration ledger rows, latest20260904222450. The former48-row August
fixture is not a current observation of that ledger. No applied entries were
fabricated or repaired. The parent customers.company_id is nullable, while the
intent company is NOT NULL and customer_id nullable.

All seven disputed company fields and companies_white_label_platform_id_fkey
exist live and in historical source. They are deliberately preserved. The live
Ediel key was the validated old all-columns SET NULL predecessor; no non-null
orphan/cross-company references were found at preflight. The new forward has
NOT been applied live in this work.

## Open release boundaries

- Reconcile the old schema reference and verify full semantic parity, including
  grants, policies, RLS, indexes and functions against an independent reference.
  Do not drop legitimate company fields or copy an observed fingerprint to green.
- Implement the supported ordinary Supabase lifecycle with reviewed ownership,
  private logging and truthful ledger evidence. The mandatory OPS native path
  is still rejected as unsupported; isolated owned-compatible is not a substitute.
- Generate/check types from the accepted schema, pass every required OPS/E2E
  check and merge only the exact verified head. Existing other CI failures are
  not declared solved by the narrower evidence above.

No schema snapshot/fingerprint, generated type file or type manifest was refreshed.
Temporary exact-patch publication workflows are removed. The permanent workflows
qualify the registered file instead of generating a fresh timestamp per run.
Main, production/connected database and deployment remain unchanged. Existing
application/API changes and the paused partner patch remain intact.
