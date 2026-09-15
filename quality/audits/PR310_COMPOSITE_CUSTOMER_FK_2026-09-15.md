# PR310 seven composite customer FK qualification — 2026-09-15

Status: IMPLEMENTED_NOT_VERIFIED for native SQL. Source selection and offline
trust-boundary tests pass. No schema/reference acceptance or production action.

## Scope and routing

Bounded source-causal review and isolated PostgreSQL17 behavioral qualification
of seven customer composite FK differences. Applied project Supabase,
differential review, false-positive checking, test-driven-development,
code-review and verification-before-completion guidance. Other security/UI/
performance/deployment groups are outside this seven-constraint fixture.
No historical migrations, runtime compiler, workflow, reference or memory edits.

## Evidence and source causality

Artifact10371643836 and the fresh335f987f ZIP both report full144+514 public
projection differences. Reference SHA256:
`e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106`;
replay SHA256:
`4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755`.
These are projection receipts, not native lifecycle or full acceptance evidence.

- `20260801143000_canonical_multitenant_platform_hardening.sql:281–309,348–363`
  explicitly adds `mt_<table>_customer_id_tenant_fk`, in company/customer column
  order, with default NO ACTION for delete/update and initially NOT VALID.
- `20260809181153_validate_pending_public_constraints.sql:14–31` validates all
  public FK/check constraints and rejects any unvalidated remainder.
- `20260902095000_lock_customer_chain_with_composite_keys.sql:48–59` skips tables
  already holding any composite customer FK. It never creates the seven
  reference-named CASCADE alternatives on this replay path. There is no seven-FK
  DROP. The installer comments establish tenant-isolation intent; explicit intent
  for changing referential actions is not documented.
- Original source commits respectively
  `0db379770ab541f3ae8c3d7fce903e8e900ad6d1` and
  `cffe9445d1349276d41dadacfa8e42a610975edb` for August installer/September lock.

All seven unchanged single-column customer FKs are absent from the artifact's
added/removed/changed lists. Reference line mapping:

| Table | Composite definition in schema.sql | Single delete action/definition line |
| --- | --- | --- |
| customer_authorization_documents | 85084 | NO ACTION / 85091 |
| customer_info_requests | 85560 | CASCADE / 85567 |
| customer_legal_acceptances | 85763 | CASCADE / 85770 |
| customer_onboarding_applications | 85882 | RESTRICT / 85889 |
| customer_onboarding_legal_snapshots | 85938 | RESTRICT / 85945 |
| powers_of_attorney | 89676 | NO ACTION / 89683 |
| supplier_switch_requests | 90110 | NO ACTION / 90124 |

## Exact artifact hash reconstruction

The fixture records all fourteen artifact row hashes in `ROWS`/`REFERENCE_ROWS`.
For each table `t`, the unique replay match is:

```python
dict(nspname='public', relname=t,
     conname='mt_' + t + '_customer_id_tenant_fk', contype='f',
     definition='FOREIGN KEY (company_id, customer_id) REFERENCES customers(company_id, id)',
     convalidated=True)
```

The reference match is:

```python
dict(nspname='public', relname=t,
     conname=t + '_customer_company_fk', contype='f',
     definition='FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id) ON UPDATE CASCADE ON DELETE CASCADE',
     convalidated=True)
```

Canonical bytes are
`json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()`;
SHA256 matches `canonical-full-schema-reference.py:41–43`. Eight replay candidate
combinations per table were checked: validation True/False, empty/public schema
prefix, empty/NOT VALID suffix. Exactly one matched each recorded hash; all were
validated. This resolves the seven-FK validation concern in the artifact, without
claiming native SQL execution. Native fixture catalog rows must match these same
hashes before behavioral probes begin.

Reproduce the reconstruction and pinned statement selection without a database:

```sh
python3 -B scripts/canonical-composite-customer-fk-selftest.py --selection-only
```

## Application evidence and false-positive disposition

The only direct `customers.delete()` found in `app`/`lib` is
`app/admin/customers/[id]/profile-actions.part-2.ts:763–768`. It requires platform
admin, RADERA confirmation and test data; protected-history checks precede writes
at588–618. The protection predicate at554–575 includes POAs and supplier switches.
Authorization documents are explicitly removed at749 before deleting the parent.
Real customers are archived/soft-closed; see part-2:522–547 and part-1:519–542.

Profile/API/portal update allowlists do not write customer id/company_id:
`profile-actions.part-1.ts:302–319`,
`lib/customer-portal/tenantSync.ts:1161–1178`,
`app/api/v1/customer/profile-update/route.ts:61–80`.
`app/admin/customers/duplicates/actions.ts:116–121,159–192` rejects cross-company
merges, moves child customer references and marks the source inactive; it does
not change the parent key or delete the source customer.

Legal immutability comes from
`20260613090000_batch_m_ops_master_legal_readiness.sql:165–176` and
`20260720110000_canonical_customer_onboarding_transaction.sql:149–164`.
The latter also declares onboarding customer references RESTRICT at106/125.

No application regression is confirmed. Single CASCADE FKs and existing immutable
triggers mean that NO ACTION on another constraint alone cannot establish one.
Raw parent key changes/deletion can differ, but no supported parent-key-edit path
was identified. Do not restore all CASCADE constraints to silence the diff.

## Native fixture boundaries and expected cases

`scripts/canonical-composite-customer-fk-selftest.py` accepts only selection-only
or execution against fixed127.0.0.1:55440/gridex_auth_test. It verifies PG17 and
admin identity, refuses a preexisting fixture database, creates its own database,
and drops only that owned database in finally. Creation itself is inside the
cleanup scope. A unique internally generated NOLOGIN role and transactional
nonce comment prove ownership independently if CREATE DATABASE times out after
committing. Cleanup verifies the nonce and database owner before DROP, checks
database absence, then drops the owner role. Unknown ownership or a concurrent
different-owner database fails closed without DROP or a cleanup success claim;
an uncertain owner role may remain on that failure path for manual inspection.
No hosted URL/SQL/table input.
Raw SQL/output/exception text is never printed on errors.

Each table is tested independently with a minimal parent/child structure. The
reference uses exact pinned dump composite and single FK statements, in dump
order. Replay uses the same single FK, the complete original August installer DO
block, the complete validation source, and the September installer DO block that
must skip the existing composite. Both exact unconditional immutable trigger
functions/triggers are retained; their complete predicates are checked against
their historical source bodies. No predicate is stubbed or relaxed.

This intentionally does not recreate all columns, RLS, other parent/child
relations or other triggers. It is not an application fixture, live trigger-OID
ordering proof, or complete graph retention proof. In particular, RESTRICT plus
CASCADE ordering is assessed only in the stated dump/source reconstruction.

Implemented assertions, awaiting native execution:

- Unreferenced test parent deletion and ordinary non-key profile updates succeed.
- Orphan and wrong-company insertions fail23503 in both alternatives.
- Authorization-document explicit child-then-parent deletion succeeds.
- Immutable legal child deletion fails with its source SQLSTATE.
- Reference raw parent delete/key cascade succeeds for non-immutable tables;
  immutable legal rows reject with P0001/55000.
- Replay raw parent key changes reject23503. Raw delete still cascades info
  requests; legal acceptances reject P0001 through the retained single CASCADE
  and immutable trigger; other retained child references reject23503.
- Every successful case explicitly rolls back; every rejection must restore
  prior marker writes, complete fixture rows and FK/trigger catalog snapshots.
- The final receipt records per-table outcomes, cleanup, and explicit false
  applicationGraphVerified/schemaAccepted fields. It is emitted only after all
  assertions and database absence verification succeed.

These are assertions to be qualified, not observed SQL outcomes. Any native
failure must be investigated before reporting the associated case as proved.

## Verification and review

- RED: `python3 -B -m unittest scripts/test_canonical_composite_customer_fk_selftest.py`
  failed2 tests before the implementation existed.
- GREEN: the same command passed2 tests after implementation. Ownership review
  then reproduced a CREATE-timeout cleanup gap;2 additional boundary tests were
  RED before the ownership context was added. Fresh full suite passes4 tests.
  Tests verify selection without a database executable, changed/symlink source
  rejection, owned creation committed before timeout cleanup while preserving
  failure, and refusal to drop a different-owner concurrent database. The latter
  two mock only the unavailable database boundary; native SQL is still required.
- Selection-only command passed all pinned source/predicate/hash checks.
- Native command attempted locally and failed closed `FIXTURE_EXECUTION_FAILED`;
  psql is unavailable. No PostgreSQL statement was executed locally.
- Manual code review checked fixed target ownership, source selection cardinality,
  full immutable predicates, independent artifact hashes, transaction rollback,
  unchanged single FKs, clean owned cleanup, and scope limits. Native SQL remains
  a required gate; root owns later CI wiring and evidence capture.

Next: run the native command in the existing disposable PostgreSQL17 CI service,
collect closed per-table receipts, then classify observed differences. Keep the
reference and all acceptance gates unchanged.
