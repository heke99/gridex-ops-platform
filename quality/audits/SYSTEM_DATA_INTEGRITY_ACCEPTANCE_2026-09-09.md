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

Review collectCustomerDeleteGraph, describeProtectedDeleteData, deleteStorageObjectsForCustomer
and all delete helpers plus their callers and actual live/canonical FK graph.
Use the full dependency matrix to design the correction; do not just add another
table to a handwritten delete list. Preserve protected historical information
under the existing approved retention contract and report any unresolved policy
choice explicitly. This audit entry does not assert a completed remediation.

## Current prerequisite example

Live role_permissions has a unique role/permission pair while the replay prefix
lacks it. The current SaaS task is being corrected to reconstruct that constraint
before source execution. Additional observed NOT NULL and FK delete-action
differences remain explicit parity work; restoring uniqueness alone is not
role_permissions or systemwide parity.
