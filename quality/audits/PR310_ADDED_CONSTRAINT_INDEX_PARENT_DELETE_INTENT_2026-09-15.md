# Five customer parent-delete contracts — source review, 2026-09-15

Source intent is resolved for this bounded group: retain the child record and
its known company when an otherwise permitted customer deletion detaches the
customer link. Preserve existing nullable/unknown input compatibility. Recommend
a narrow, separately qualified repair candidate changing only the five listed
composite constraints to ON DELETE SET NULL (customer_id), retaining ON UPDATE
CASCADE and every simple/other FK. The coordinator's PostgreSQL characterization
and repair qualification must pass before promotion. No PostgreSQL, application
end-to-end or source-execution claim is made by this review.

This complements the immutable 211-row register
`PR310_ADDED_CONSTRAINT_INDEX_CONSTRAINTS_2026-09-15.json`; that register's
observed hashes and false acceptance flags are unchanged. No historical source,
reference, type file or existing runtime file was edited here. Differential
review and false-positive checking distinguish authored retention intent from
one FK's catalog action and from complete application execution.

## Exact scope

All five tables are absent from the reference and present in the retained 9f
replay. The existing register gives all 18 coexisting FKs, source pins and full
rows. The relevant added composites are:

| Table / constraint suffix `_customer_company_fk` | Full row SHA256 | Observed delete action |
|---|---|---|
| billing_disputes | 1e7d42c4d4c83bfee570e243310f8f424faa728ad2cc1685f1f9a6c904d0daae | CASCADE |
| customer_import_rows | b66b2e270299a2b186d2cda94058f9eb29ba7319681190652c4a27072f3cb3e7 | CASCADE |
| data_quality_findings | 8f8bbc3fd359d097c365cb00650240de5547a6bf063549486363aee9395215bd | CASCADE |
| document_parse_jobs | b1343fdc2c85899dde079e8fd689cedd31b43c60a61888050aa4659a5b7e832d | CASCADE |
| customer_sync_events | 81ccd65a6947960b1b6523582cc9542dba375e17e454a21ba97892da3e1d6980 | SET NULL on both columns |

Each uses `(customer_id, company_id) REFERENCES customers(id, company_id)` with
ON UPDATE CASCADE, MATCH SIMPLE and validated=true. The first four also retain
a simple `customer_id REFERENCES customers(id) ON DELETE SET NULL` FK. No
assumption that either overlapping action dominates is justified without
checking actual referential-trigger ordering and execution.

## Retention contract for the four overlapping cases

| Table | Authoritative table-specific source | Meaning of retained row |
|---|---|---|
| billing_disputes | `20260609162000_batch_7_website_integration_foundation.sql:534–554`, especially customer FK at537 | Nullable customer and invoice-export links are SET NULL; independent provider invoice/debtor identifiers, customer number, evidence_snapshot, amounts and resolution history survive detachment. |
| customer_import_rows | `20260526_debug_step1_2f_customer_import_foundation.sql:28–50`, especially customer FK at36 and guarded recreation at140–147 | The import-batch row, raw/normalized payload, row number, confidence and review outcome survive customer detachment. The batch itself remains its separate cascading parent. |
| data_quality_findings | `20260531111600_system_readiness_foundation.sql:287–306`, especially customer FK at292 | The finding has independent entity_type/entity_id, issue identity, evidence and resolution metadata; optional customer association is SET NULL. |
| document_parse_jobs | `20260615_multitenant_integrity_and_claim_locks.sql:422–440`, especially customer FK at425 | The parse job retains document-extraction association, storage/hash, parser information, payload and errors after customer detachment. Both customer and extraction links explicitly permit SET NULL. |

The September2 generic customer-chain migration describes closing parent/tenant
existence gaps; its Step1 CASCADE template is not a table-specific reconsideration
of these four explicit nullable retention contracts. Keep its tenant-qualified
existence invariant. If characterization reveals destructive or order-dependent
behavior, align the composite's customer-delete action with the retained
single-FK behavior while preserving company_id. Do not replace it with NO ACTION
without a separate retention decision requiring customer deletion to fail.

Only customer_import_rows has active literal app writers among these four.
`app/admin/customers/actions.part-3.ts:296–314` inserts scoped import evidence;
675–683 and775–785 link created/existing customers. The imports page reads rows
by retained batch identity (`app/admin/customers/imports/page.tsx:157–166`).
`createCustomerFromImportRowAction` refuses rows whose status remains created
even when customer_id is NULL (actions.part-3.ts:658–659), so retaining historical
rows does not implicitly permit another customer creation. Duplicate resolution
moves their customer link inside the verified company scope
(`app/admin/customers/duplicates/actions.ts:74–99,156–168`) and marks the source
customer inactive/merged; it does not hard-delete that customer.

No literal app/lib read or write of billing_disputes, data_quality_findings or
document_parse_jobs was found in the scoped search. That limits active-workflow
claims; their exact authored SET NULL contracts still establish schema intent.
Dynamic SQL or external writers are not certified absent.

## Sync journal: nullable input is not permission to erase a known tenant

`20260519_operations_core_saas_sync.sql:2–3` identifies a guarded foundation for
partially upgraded databases. Lines104–140 create a durable matching journal,
with nullable company/customer/site/metering identifiers. The table comment
explicitly requires tenant-safe unresolved/matching history, and the company
column comment says that the tenant owner must be populated for SaaS production.
No source assigns NULL company a platform-wide meaning for this table.

The September2 classification source makes NULL meaning explicit for legitimate
mixed tables (lines121–152); customer_sync_events is not among them. Its generic
company-column seed assigns tenant (88–94), subject to the separate no-client-
privilege system classification (157–171). The observed sync FK is specifically
the Step2 SET NULL definition, and that generator requires a classification row
with kind=tenant (`20260902095000_lock_customer_chain_with_composite_keys.sql:90`).
Thus the table qualified as tenant when that FK was installed; the final native
fixture should verify current classification rather than guess it.

The existing invariant gate is decisive:
`scripts/sql/tenant-isolation-invariants.sql:89–110` rejects company_id=NULL rows
in tenant-classified tables. Mixed tables must separately declare what NULL
means. The generic MATCH SIMPLE allowance and nullable legacy column avoid
forcing a lossy backfill; they do not authorize clearing a known company from
an otherwise retained journal row when its customer disappears.

Decision: preserve unknown/legacy NULL inputs without changing column nullability
or inventing a default company, and preserve a non-NULL company when customer_id
is detached. The inspected literal consumer is the control-tower unresolved/
pending count (`lib/tenant/controlTower.ts:113–115`); no active journal writer
was found. The concern is loss of recorded tenant attribution and a violated
F-3 invariant, not an asserted cross-tenant disclosure or active attack.

## Actual customer-delete route and limits

The platform-admin-only `deleteCustomerForRecreateImpl`
(`app/admin/customers/[id]/profile-actions.part-2.ts:585–619`) requires the
RADERA confirmation and a marked test customer. It rejects the listed contract,
invoice, Ediel, legal/document and communication histories. The collector
(60–185), protection predicate (555–575) and explicit cleanup (745–761) do not
query or remove these five tables. The final service-client delete targets the
customer at763–768. Platform data cleanup delegates the same action
(`app/admin/platform/data-cleanup/actions.ts:64–92`).

Consequently, the application guard admits an otherwise empty marked-test
customer whose only related row is in one of these five tables. Other database
constraints/triggers may still reject the final statement, so this is a source
reachability observation, not a successful live deletion receipt. Real customer
history is archived by this path; no permission to delete real history is inferred.

## Real child triggers and qualification design

Exactly three added noninternal trigger rows affect this group, already fully
reconstructed in `PR310_SCHEMA_ACCEPTANCE_COVERAGE_2026-09-15.json`:

- customer_import_rows_tenant_operational_guard_trg, SHA
  c7584eb00cfa0acb23d609e67c67d0e0aa9fc1686f44da90808a0a54356c7582;
- gridex_audit_customer_import_rows, SHA
  6c03f498b87cb498cd78dbdc39b2b2a2e6e7540897127b6dec1ed41941956e37;
- customer_sync_events_tenant_operational_guard_trg, SHA
  4afc0dc04430c18321361db8f3396b14635001dba0a13bc8a1cbff24f4f9ae5d.

The current operational function is the May19 6d2 source at328–352, function-body
MD5 fcdd8e61b45af7096cf2654d767e12a0. It queries only companies.status and returns
NEW for NULL company. It does not verify tenant membership or parent existence.
The final audit function is the May22 source at87–150, body MD5
0bb25c59cc22963c529f3e7dce21d883. It appends company/actor/entity/action and OLD/NEW
snapshots to audit_logs; the older May20 body differs and must not be substituted.
The added-function audit independently reconstructs both complete function rows.

A bounded fixture can use both real functions with minimal companies/Auth/other
parents and a private audit sink, while explicitly limiting claims about the
full audit_logs trigger/FK graph. It must bind the 18 FKs and three trigger rows,
check both overlapping FK creation/order variants, and capture actual trigger
ordering where claiming a native replay outcome. Dump/restore can recreate
internal FK trigger identities; a clone outcome alone cannot establish the
original database's action order.

Required meaningful controls include valid same-company links, wrong-company
rejection, allowed NULL optional links, all four parent-delete combinations,
known-company preservation for sync detachment, unchanged preexisting NULL
records, real operational-guard behavior, audit append outcome, rollback and
outside-row preservation. These are the coordinator's execution work, not
results claimed here.
