# Customer and Ediel operations source characterization

Status: standalone whole-source native PASS on279e0f55.
OPS34653186725/job103439770379 SUCCESS22:17:15Z.
No actual71 claim, live migration or production readiness conclusion. Accepted predecessor is actual68 at0ca45764,
OPS34650841849/job103432379255 SUCCESS21:54:51Z.

## Complete immutable sources

| Key | Source | Lines | SHA256 |
|---|---|---:|---|
| L | 20260519_customer_move_out_lifecycle.sql | 73 | cd2a6b782bf1a5571c0d77dc948440b55e076df01b8986c58e97d07c9ab239b8 |
| E | 20260519_ediel_tenant_profile_runtime_sync.sql | 90 | b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e |
| U | 20260519_operations_customers_ux.sql | 81 | caafdfde64eaf88d952a23465ef8aed307ce49e40ed54c6cf84b613e873f5b2a |

All244lines read; independent review of complete sources and relevant actual68
predecessors found no missing prerequisite in the normal shape. This is source
analysis, not native acceptance. Manifest and original bytes remain unchanged.

L adds nullable lifecycle columns/partial indexes, a journal with its constraints,
RLS and one service policy, and two comments. The final CREATE/FKs/COMMENT still
require customers/companies/auth.users despite earlier conditional blocks.
The historical journal customer FK is CASCADE; source comments do not prove
retention. There is no composite tenant FK or tenant read/write policy here.
The existing tenant-policy-gap view must expose all three missing named policies.

E conditionally adds company_id/indexes on12names, adds3composite indexes and
3comments. Only actor settings, communication routes and Ediel route profiles
backfill NULL company_id, and only with exactly one company. Existing6D2 guards
reject non-NULL company.status outside active/onboarding with P0001. Timestamps
and all other fields must remain unchanged. Existing test_run_messages gains a
nullable company_id but is not backfilled. Three optional meter/billing relations
are absent at actual68; no effects on absent tables may be inferred.

U adds archive fields, conditional FKs and8indexes. Its FK-name test is global.
The existing company FK retains NO ACTION; a foreign same-name constraint can
suppress the archived_by FK. This behavior is characterized, not silently fixed.
Later canonical migrations must establish final tenant and lifecycle guarantees.

## Candidate proof

The new standalone harness consumes the exact successful actual68 release and
rechecks its reference/run/fixed-completion/owner links. It verifies the raw
extended catalog and complete row multiset against the frozen committed release
before cloning. Native and oracle clones are exclusively owned, fresh and
checked against the original; failed clone admission removes only the new clone.

The independent DDL path extracts pinned direct declaration ranges and resolves
presence/policy/global-FK-name conditions separately from original DO bodies.
The row model adds nullable fields and maps only the three conditional backfills.
Every original byte executes in memory inside one transaction. The final catalog,
relation/column comments, global constraint names, and all public/auth/storage
rows/sequences must match before COMMIT, with another check after COMMIT.
Original source files are revalidated; original DB and canary must remain exact.

Native matrix prepared: baseline+repeat, populated single/zero/multiple company,
blocked company with/without affected rows, populated test-run message null-owner
preservation, late orphan FK failure, missing required table/indexed column,
missing optional relation, foreign constraint-name collision, and an exact22012
fault after each complete source. Journal enum/FK/ACL denial and labelled
rollback-only policy/cascade probes preserve actual ACLs and rows.

Local9constructors PASS. Physical direct/staged ownership, stale completion links
and clone-origin cleanup regressions were observed RED then GREEN. Native SQL
is pending in the new20min isolated PG17 workflow with exact always-cleanup.
Static expected normal delta, pending native measurement:1table/15columns/
8constraints/20indexes includingPK/1policy/5comments. No SQL success follows
from these counts or from local constructors. Global46dispositions remain open.

Independent implementation/native-matrix review APPROVED for incremental
publication and hosted validation. Nine constructors, syntax, diffcheck and
all three original hashes independently verified. Native results remain pending.

## Native receipt and next integration

All14source cases PASS in the job above, including full catalog/comments/rows,
privilege/constraint probes, exact rollback and original/canary preservation.
Always-cleanup PASS. The independent test emitted only finite outcome labels;
no production/customer data was used. This closes the pending standalone gate.

A separate reviewed actual71 runtime now selects these complete files at
foundation69–71. Existing first68 and old41tail order remain exact. It uses the
original live controller and held sources, with an independently prepared extra
catalog baseline and exact single-transaction completion. Source registration is
INPUT_SELECTION_ONLY; native71 acceptance is pending its separate hosted gate.
Source bytes, history manifests and timestamp order remain unchanged.
