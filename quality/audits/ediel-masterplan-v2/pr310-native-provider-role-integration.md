# PR310 native provider-role qualification — 2026-09-16

## Observed failure and independent reproduction

The ordinary native replay on58dfddba (OPS35113974007, artifact10458331571,
ZIP SHA256 f3ba6b5b9642f02ebd51b43fe1d7ad80b0aa50b5897f5feee4881781ac9746a4)
executed144 foundation,514 historical timestamps and12 forwards, all five final
SQL checks and2496 policy actor cases. It then stopped at
REMOVED_POLICY_ROLE_GRAPH_REQUIRED. Cleanup/private disposal passed. No full
native schema comparison or application type candidate was exported.

The same role failure reproduces on a pristine owned official Supabase database,
without application migrations (run35123389668, artifact10457244761).
The provider Storage LOGIN has a SET-only route through authenticator to
service_role. It does not inherit service-role privileges. The previous witness
classified this existing platform role as an unreviewed application LOGIN.

## Bounded correction

The native witness admits only the measured four direct provider edges with
exact role names, grantors, ADMIN/INHERIT/SET options, flags and complete LOGIN
origin set. authenticated/anon may not reach Storage or a bypass role. The
original metadata independently cross-binds the three provider principals.
Provider names alone do not authorize an exemption. Portable targets cannot
supply this native context. Captures are read-only and repeated around the
unchanged metadata/composition check. All table/column/owner/RPC ACL guards,
267 policy hashes,23 table shapes and original source SQL remain unchanged.
The native receipt requires a new verified-chain flag; old native receipts
cannot be relabelled as current proof.

## Executed proof and publication

Run35126794371 qualified exact tree3b70eec7b4cc5d1db5369fe6921cc764aef0779d,
then published clean commit98afe8a21f1a75acfd9e127d7034f2df90f8ea94.
Artifact10459294830 ZIP SHA256
9ddf0daad2527630efa922addb38566aaa21ceff3a67ca5e2ef07f282dbd716b.
All seven Python command groups (74 tests) and migration integrity passed.
The genuine native fixture reproduced the old rejection, accepted the exact
pristine graph, rejected ten mutated role graphs and verified PostgreSQL's own
0LP01 rejection of the reverse-edge cycle. Each attempt rolled back; exact
role/catalog snapshots and positive recovery were verified. An unrelated
unprivileged LOGIN remains permitted. The existing native lifecycle's real
CLI ledger/repeat/rollback and cleanup also passed.

The retained role proof is byte-identical to the artifact:
pr310-native-provider-role-proof-35126794371.json SHA256 67e0ee1dfd97f1e2106c6fca0433f9771fb03d7dda4d18fc54cd54056aff4c52.

Earlier isolated attempts are NOT reported as passes: run35124842164 first
failed to start its database, then exposed a JSON boolean encoding defect in
the disposable probe. Run35125507499 reached the deliberate cycle; diagnostics
in35126334303 established0LP01. The final fixture separately asserts that exact
server rejection instead of misclassifying it as a validator success.

## Existing qualified work preserved

Merge the clean36d0f80b2f0f7cfc39815e654a892daca4b8af26 descendant, not its
temporary publication workflow. Its six files separate portable postgres
Storage ownership from native supabase_storage_admin ownership, preserving
all other clauses. It also binds only two previously reviewed function changes
to their pinned source audit and actual24-case native behavior witness.
Run35116624508, artifact10455474644, ZIP SHA256
27398b4ad9fd3f48e73f14b95e45cfed1f81bc01f8012720f99e52162849cf90
proved its full portable144/514/12 execution. The independent schema difference
remained a failure, not an approved baseline. All six file hashes and the
published commit/tree were read back and checked before integration.

## Remaining release boundary

This is a verified prerequisite correction, NOT a full native schema/type or
release certificate. The integrated current head still needs a complete native
replay, reviewed schema evolution, genuine application type generation and all
mandatory CI gates. Historical SQL, the independent schema reference and the
type manifest have not been rewritten. No hosted database, production service,
external market message or main branch is changed by these tests.
