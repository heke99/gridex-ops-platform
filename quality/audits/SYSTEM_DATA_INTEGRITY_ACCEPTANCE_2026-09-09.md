# System data integrity acceptance contract

User steering2026-09-09 supplements the existing masterplan: intended system
behavior, indexing, IDs/relations, consistent tables across every path and correct
customer deletion are required. This document specifies gates, not active status
or evidence that they pass. Active status remains .agent-memory/current-state.md.

## Required system evidence before completion

| Area | Required evidence |
| --- | --- |
| Identity | Every persisted entity has an appropriate stable primary key; legitimate composite keys are preserved. Referencing columns use compatible types and unambiguous canonical IDs. |
| Relations | Table-by-table PK/FK/nullability/unique ownership matrix, with tenant/company scope and validated constraints; no unaccounted orphan records. |
| Indexes | Index inventory supports actual FK joins, lifecycle deletes and measured query paths; redundant indexes and missing index coverage are assessed against actual workload. |
| Consistency | Code, API contracts, jobs, views/RPCs, generated types and canonical/live schema use the same table/field semantics; legacy aliases and replacements have explicit lineage. |
| Deletion | Each customer dependency is explicitly removed, anonymized, detached or retained according to system rules; shared and other-tenant records remain intact. No blanket cascade conversion. |
| Failure recovery | Database state transitions are transactional where required; external storage/job side effects have retryable recovery and idempotency. No false success after partial failure. |
| Lifecycle | Real-customer archive, test-customer hard delete and retention/anonymization are separate supported contracts, each with authority checks and audit evidence. |
| Verification | Two-tenant synthetic tests, graph/orphan checks, repeat calls, concurrency and failure injection verify intended behavior without destructive production tests. |
| Completion | Full replay, generated artifacts, migration ledger and actual production database converge through parity engine; passing isolated fixtures is insufficient. |

## Concrete evidence to carry into customer lifecycle task

Entry point: app/admin/customers/[id]/profile-actions.part-2.ts:584-780,
deleteCustomerForRecreateImpl. Static inspection confirms platform-admin access,
explicit confirmation, test-data check and protected-history check. It then deletes
storage objects, writes an audit event and issues multiple sequential database
deletes before deleting the customer. This inspected path is not one database
transaction. Partial-failure recovery, concurrent changes, dependency graph
completeness, table-missing tolerance and tenant scoping require targeted review
and execution before deletion can be called correct. No destructive request was
made, no customer data read, and no exploit reproduction is needed.

Additional bounded source evidence: profile-actions.part-2.ts:15-59 returns a
failed storage-object count, while the caller only records storageSummary in
the audit and continues the database deletes. The final path redirects after
customer deletion without establishing recovered storage cleanup. Helpers in
profile-actions.part-1.ts:911-937 tolerate missing tables/columns during selected
deletes. These facts require explicit cleanup/recovery and schema-contract
acceptance in the lifecycle task; they are not evidence of an actual production
incident. No runtime behavior has been changed by this evidence entry.

Review collectCustomerDeleteGraph, describeProtectedDeleteData, deleteStorageObjectsForCustomer
and all delete helpers plus their callers and actual live/canonical FK graph.
Use the full dependency matrix to design the correction; do not just add another
table to a handwritten delete list. Preserve protected historical information
under the existing approved retention contract and report any unresolved policy
choice explicitly. This audit entry does not assert a completed remediation.

## Prerequisite example — scope decisions

The role/permission unique pair and intended company-invitation status index
must be established before SaaS source execution. Corrected identity evidence
requires mandatory role/permission references while preserving both existing FK
actions and OIDs. The intended parent lifecycle and any FK-action reconciliation
remain separate required work; no CASCADE reconstruction belongs to the narrowed
reference repair. This scoped repair cannot establish role_permissions or
systemwide parity. Current implementation and run outcomes belong only in
.agent-memory/current-state.md and the durable verification receipts.

The masterplan sections 69, 83 and 120 remain binding: customer lifecycle must
be traced end to end, critical invariants belong in the database, and schema/
replay/parity prerequisites precede later domain completion. The customer-delete
correction is retained under P1-C with structural prerequisites under P0-C/P1-A;
it is not dropped or marked complete because a narrower join repair passes.

## Parent-lifecycle prerequisite discovered in separate review

Fresh read-only catalog on connected project piidsfebjqjmnepdpnas (2026-09-09)
shows user_roles_role_id_fkey CASCADE to roles(id) and
user_permission_overrides_permission_id_fkey CASCADE to permissions(id), both
validated and not deferrable. Selected core user_roles lacks the roles FK.
Therefore a role_permissions-only cascade change cannot establish safe general
parent deletion: same-parent assignments (including disabled history), legacy
key-only references and permission overrides need their own lifecycle decision
and synthetic preservation/deletion assertions. Source assignment removal uses
soft disable; it does not alone authorize a new parent hard-delete retention
policy. Keep this dependency internal and open. Mandatory grant IDs can proceed
as a separate repair preserving existing FK actions. No live rows were queried.

## Bounded direct-customer catalog inventory

Read-only pg_constraint/pg_attribute/pg_index observations on the connected
Gridex project (2026-09-09) are preserved in
[CUSTOMER_DIRECT_FK_CATALOG_2026-09-09.json](CUSTOMER_DIRECT_FK_CATALOG_2026-09-09.json).
There are 175 direct customer FKs across 100 child tables; all observed FKs are
validated. This is not a transitive graph or an inventory of logical/storage
links, and runtime-to-project identity remains unproven.

Of 23 composite ON DELETE SET NULL FKs, 14 include a NOT NULL column in the
SET NULL target list. Examples: billing_export_run_items.company_id,
customer_communications.customer_id/company_id, and
customer_readiness_snapshots.customer_id. This is a confirmed catalog tension,
not an executed claim about complete trigger ordering or production incidents.
Any design must settle retain/detach/delete semantics while preserving tenant
identity; never remove NOT NULL or tenant constraints just to permit deletion.
Synthetic tests must establish final behavior including other FKs/triggers.

Forty FKs do not meet the bounded complete-leading-key index screen. This screen
excludes partial/expression indexes and requires all FK columns in the leading
key set; a subset-leading index can still serve a real workload efficiently.
These are review candidates, not forty proven missing indexes or a mandate to
create redundant indexes. Inspect actual definitions, query plans and lifecycle
workload before deciding. No customer records or secrets were queried.

Source trace for the catalog tension: immutable migration
supabase/migrations/20260902095000_lock_customer_chain_with_composite_keys.sql
lines55-60 adds composite CASCADE without deriving each pre-existing single-FK
delete action; lines102-115 adds composite SET NULL without a column target
list or a NOT NULL compatibility check. This explains the class of catalog
shapes under review. It is not a reason to remove composite tenant integrity.
A forward correction must use an explicit table-by-table lifecycle contract,
retain company ownership when detaching customer identity, and preserve protected
history. Do not edit this historical migration or apply one blanket action.

A second catalog-only check verifies that all100 directly referenced child
tables have a primary key; definitions are retained in
[CUSTOMER_CHILD_IDENTITY_CATALOG_2026-09-09.json](CUSTOMER_CHILD_IDENTITY_CATALOG_2026-09-09.json).
Do not add replacement IDs merely because table names differ. Three child
tables have no company_id and36 have a nullable company_id; these need explicit
ownership classification, not automatic column addition or NOT NULL conversion.
This does not verify logical-only dependents, key compatibility across every
consumer, tenant isolation, row integrity or production runtime binding.
