# Ediel customer/company forward correction — 2026-09-14

Status: IMPLEMENTED. Registered migration and native qualification verified;
full-chain replay, managed Supabase lifecycle, full parity and new generated
types are NOT accepted by this report.

## Evidence and change

Original source: `dbb090ce19939c7735b012749155617d86a9e9fd`.
Native qualification run34783208530 passed the candidate. The official CLI
2.101.0 generated `20260913211625_ediel_intent_customer_company_integrity.sql`
without connecting to a database. Artifact10324809056 ZIP SHA256:
`21789410a2bc2a0c0a5084569ac77201aafcb7ad246d9d62e12682c7b64f6803`.
The integrated SQL is byte-identical, SHA256:
`da2d3d288d69038b4c9767fe22b2a1ae4293d3196d88b5d129089337594392b9`.

Code commit: `4f45b185579dddadb702189cc4d0454eb17b58fd`.
Run34787275348/job103804910813 passed nine self-test scripts plus the native
PostgreSQL FK qualification on that actual registered file. The full source
projection matched independently computed tree
`6ee9ef3ea0ff4178299c324f7ab9e277400d773e`. Receipt artifact10327296393 ZIP SHA256:
`1bfc82073e89724c4a60932c068efd543ca254bc5851102f085620df91df8f3f`.

The native tests execute both actual historical classification/FK migrations,
reproduce missing-FK and old customer-delete NOT NULL failures, then prove:
cross-tenant rejection; customer-only detachment retaining company and payload;
idempotence; unknown-predecessor rejection; dirty-row rollback without deletion;
and no unrelated public/auth/storage catalog changes, including grants/RLS.

The append-only runtime manifest admits the new forward file. Historical SQL
and original manifest bytes are unchanged. Inventory is601 files; whole selected
originals589; foundation144; timestamp514. Exact new last-file/hash assertions
preserve the former historical tail at index-2. Two substitutions and five
unclassified legacy-selector entries remain visible and separately accounted
by the seven-source residual contract, not silently skipped. Five explicit
noncanonical exclusions are unchanged. Private permission assertions stay0600.

## Independent connected-database preflight

Read-only inspection of gridex-ops-dev (`piidsfebjqjmnepdpnas`) observed PG17.6,
279 actual migration rows, latest20260904222450. All seven disputed company
fields and companies_white_label_platform_id_fkey exist live; preserve them.
The live Ediel key is validated but has the old all-columns SET NULL behavior.
No orphan/cross-company non-null customer references were found. No live write
was performed. The old 48-row August ledger fixture is not current evidence.

## Previously pasted privacy blocker

Run34783208278/job103793862831 on dbb090ce ended with privacy VERIFIED and
disposal VERIFIED. The five old provenance gaps have been superseded by actual
writer/handle/staging/phase/physical-identity admission. No hash-only exemption,
privacy override, or acceptance relaxation was introduced here.

## Release boundary

Temporary exact-tree publication files are removed. Permanent FK/residual
workflows now test the registered migration and run when migration bytes change.
They no longer generate a different forward timestamp on every CI rerun.
Local workflow ownership self-tests passed3/3 after these workflow edits.

No expected schema fingerprint, accepted schema dump, generated types or type
manifest was refreshed. Full schema semantics, the supported ordinary managed
Supabase lifecycle and its truthful ledger must pass before regenerating those
artifacts or merging PR310. Main, production and application deployment are
unchanged. Existing API/application work and the paused partner patch remain.
