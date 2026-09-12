# Task11b managed ACL metadata delta

2026-09-12. COMPLETE read-only delta; whole-policy/100-CRUD acceptance remains OPEN. One report written; no database query, implementation, candidate, memory, index or source-selection change. Task11c author/root edits preserved. Applied the previously read Supabase/source-to-sink/fp-check scope; no repeated broad scan.

**Scope decision:** the new receipt establishes an evidence-backed **current connected-project access baseline** for the ten tables. A fixture can reproduce those observed ACLs explicitly without inventing permissions, provided it is labelled observed-state reconstruction. It cannot treat them as creation-time grants or as the preimage of historical transformations. Prefer that finite observed-state fixture for current policy/CRUD characterization, alongside the existing separately labelled selected-source composition lane. Neither establishes production runtime binding or complete historical replay.

## Evidence identity

| Input | Bytes | SHA-256 |
|---|---:|---|
| `quality/audits/RLS_MANAGED_METADATA_OBSERVATION_2026-09-12.json` | 30359 | `6dadd2ee0b2549ef398421053ca62dd71cd39045ca504dc1c73be7aa0e49f724` |
| Prior `task-11b-composition-report.md` | 56235 | `ccf05825cf14f8105ad888baf90663044576b46b447f3e58f9ceaa96307cbd47` |

Root's receipt identifies connected project `piidsfebjqjmnepdpnas`, `gridex-ops-dev`, managed version17.6.1.084; database `postgres`, server17.6; observation `2026-09-12T09:20:37.902742+00:00`. Ledger count279/tail20260904222450 is an observed count/maximum, not proof of every migration identity/effect. Runtime→DB binding remains UNPROVED. No policy expressions, function bodies, complete columns, constraints, triggers or customer rows were collected.

## Uncertainty resolved, within that observation

All ten rows have the same properties: public ordinary tables, owner postgres, RLS=true, FORCE=false, raw ACL `{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`, zero nonnull explicit column ACL entries. Effective SELECT/INSERT/UPDATE/DELETE and public-schema USAGE are true for authenticated/service_role; anon has schema USAGE but all four table privileges false. Thus these tables are not grantless in the observed project. An authenticated DELETE privilege is not a permissive DELETE policy or an accepted deletion.

| Earlier uncertainty | What the receipt now supports | Still outside the receipt |
|---|---|---|
| Ten-table privilege baseline | Current owner/raw grants, effective three-role CRUD and no explicit column grants | Grant timing/source, former owners/defaults and historical column ACLs |
| Managed role existence | 31 roles; all six named June consolidation candidates exist, including supabase_privileged_role | Role universe at June12; explicitly targeted roles in preceding policies |
| Role inheritance | 22 edges with grantor/admin/inherit/set options | Earlier edges; policy membership roster without policy catalog |
| Current default ACLs | 24 owner/schema/object-type records | Original defaults or which grant created an existing table ACL |
| Project/version/ledger identity | Current connected-project metadata above | Application runtime binding, full ledger/source/effect parity |

Role attributes materially differ from the compatible bootstrap: observed anon/authenticated/service_role have INHERIT=true; authenticator has INHERIT=false, and its membership edges to those roles have inherit=false/set=true. service_role and postgres have BYPASSRLS; observed postgres is **not** superuser; supabase_admin is superuser. supabase_privileged_role is non-superuser/non-BYPASSRLS and receives no critical-table ACL entry. Incoming membership from postgres does not grant privileges in the reverse direction. These facts support a current role model, not unquestioned reuse of the fixture's different bootstrap flags.

The postgres/public default rows contain only postgres/service_role for tables/functions/sequences; supabase_admin/public rows still include anon/authenticated/service_role. These are exact stored default-ACL records, not proof of effective privileges on every future object. Existing authenticated table grants and narrower current postgres defaults coexist; installing only current defaults cannot reconstruct existing ACLs.

## Why it is not historical authority

The four already-inspected source transformations give a concrete boundary:

* **June12 consolidation** selects six existing named roles plus explicit non-PUBLIC targets from all public permissive policies, then freezes/OR-combines prior policy expressions. Today's31 roles and22 edges cannot reconstruct that earlier catalog; the new receipt contains no policies at all. Selected/substituted/unclassified DB3/intake/May31 effects remain unresolved.
* **August2 emergency lockdown** changes defaults for future objects, explicitly preserves existing grants, and catches insufficient privilege when changing supabase_admin defaults. The observed owner-specific difference is consistent with that source model, but does not prove the migration ran, which branch ran, or absence of later changes. Do not manufacture a historical failure/success receipt.
* **September2 09:20 cleanup** tests selected policy roles against `information_schema.role_table_grants`; **09:40 classification/cleanup** tests effective table CRUD. Under today's observed ACLs, the latter's grantless predicate is false for all ten tables and for policies targeting authenticated/service_role; an anon-only policy has no such privilege protection. No actual drop set or classification result can be claimed without the missing policy/classification catalog.
* Reproducing today's grants **before** those transformations defines a reviewed counterfactual fixture precondition, not proof they held then. Adding grants **after** a grantless replay cannot restore policies already dropped or correct prior classification/FK enrollment. A current-state reconstruction should materialize its admitted final catalog directly, rather than rerun historical cleanup against an invented preimage.

The earlier warning “no managed current ACL receipt” is narrowed by this evidence. Its stronger blocker “no original/pre-transform ACL authority” remains. Absence of anon column ACLs is now established only for these ten current tables, not for the separate16 access-table cases or helper functions.

## Exact next finite inputs

These are proposed follow-up inputs for root to authorize/collect separately; none was queried in this lane.

1. **One coherent current catalog baseline:** retain project/time/ledger identity and recheck this role/ACL fingerprint together with exact policies on the ten tables: relation/name, command, permissive/restrictive, role names, USING/CHECK and RLS/FORCE flags. Include table classification rows. The combined receipt prevents silently mixing ACLs at09:20 with a later policy state. For a current-state fixture this closes the complete policy-set input; it does not resolve policy history.
2. **Exact row-shape and constraint/trigger input:** ten tables plus the already identified FK parents and the two extra18-family tables, customer_legal_acceptances/contract_price_snapshots. Collect column type/default/nullability/generated/identity metadata, complete FK/check/unique/index definitions, enabled trigger definitions, owner and dependency ACLs. Follow only actual default/trigger/FK dependencies needed by the declared synthetic positive row shapes; do not replace them with convenient empty tables.
3. **Finite function/source identity closure:** current definitions/security mode/owner/search_path/EXECUTE ACLs for the prior report's lifecycle/session/platform helpers and triggered functions, recursively bounded to their actual row-test dependencies. Hash against repository slices. Any mismatch is unresolved effective-source authority; do not silently substitute the latest filename. The receipt supplies no helper execution privileges. Model managed/local postgres superuser differences explicitly while testing real authenticated/service roles.
4. **Separate admission provenance:** freeze the observed-state input hash, exact ACL/role reconstruction statements derived from it, source-body slice hashes and declared local role deviations. Preserve exact target ACL membership/grantor/privileges; avoid schema-wide/default blanket grants. Privilege reconstruction is observed-state setup, never a historical migration source. Own positive controls must reach the real policies/triggers, with exact denied/zero-row/error and before/after multiset checks.
5. **Choose the historical claim explicitly:** current observed-state100-CRUD +18-reference characterization may proceed after inputs1–4 and independent review. Whole chronological source equivalence still needs authoritative pre-transform policy/role/ACL preimages or reviewed complete source-effect dispositions for the already named omitted/substituted sources and inter-stage deltas. If unavailable, keep that claim BLOCKED; do not change immutable selection/manifests. Production acceptance separately needs runtime→project binding and managed API execution. The16 access-table family needs its own finite ACL/catalog inputs.

No new permission model or policy may be invented to bridge these inputs. Current-state native tests and selected-source tests should report divergences explicitly; neither silently stands in for the other.

## Supporting source verification

Only the previously identified relevant blocks were reread; whole-file SHA-256 remains:

| Source under `supabase/migrations/` | SHA-256 |
|---|---|
| `20260612143000_performance_policy_consolidation_and_index_cleanup.sql` | `ff3b3c65b97e36cb6c0bad1f25e4ff332debf3993c845c9856cf4fadea748b60` |
| `20260802190000_canonical_emergency_access_lockdown.sql` | `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43` |
| `20260902092000_view_security_invoker_and_dead_policy_cleanup.sql` | `911df38c226051d3b60726d8027f322bc566d30d72e51632b71797fb88ef0ed2` |
| `20260902094000_platform_table_classification_and_invariant_gate.sql` | `29ea84caceca14260c6a909534c89a26a015568d9bf56741cd796a5cd1896470` |

Verification: receipt SHA matched root's supplied value; parsed counts31/22/24/10 and exact uniform ten-table ACL/access properties checked. Report-only source inspection; no native execution, managed CRUD, historical transformation acceptance or Task11a/11c change.
