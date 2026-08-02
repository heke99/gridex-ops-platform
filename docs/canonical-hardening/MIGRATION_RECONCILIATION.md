# Migration reconciliation

Release decision: **NO-GO**

The local repository contains a long forward-only history, while the connected Supabase ledger reports only nine applied migrations. Versions `20260802010000`, `20260802011000` and `20260802012000` are absent from the ledger although their principal function bodies are present in the schema.

## A–C body comparison

| Function | Local/remote MD5 | Length | Result |
|---|---:|---:|---|
| `canonical_tenant_operation_decision` | `1253db85055adb3ebf820b11206fc6e3` | 3769 | MATCH |
| `canonical_transition_tenant_lifecycle` | `5053c328f53038a2395b764922b7c7b2` | 6260 | MATCH |
| `canonical_transition_ediel_production` | `9c5dc49a385f255f1cb451c489a66119` | 11701 | MATCH |
| `canonical_approve_first_live_send` | `a274bf891c808fce8cde28637fe654ed` | 3349 | MATCH |
| `prevent_ediel_configuration_snapshot_mutation` | `26cc8ea6a4b17b45e512fca46146e0f5` | 77 | MATCH |
| `canonical_capture_ediel_configuration_snapshot` | `b20920c7ff7adfc36c5568458db51dd4` | 8057 | MATCH |
| `canonical_save_ediel_actor_profile` | `6f3c34e67ba68c7432d93849b60faf38` | 7897 | MATCH |
| `ediel_configuration_change_snapshot_trigger` | `9c595ef286ac6eaec1a97e7e231c79c8` | 510 | MATCH |

This proves function-body parity only. Full table, constraint, policy, trigger and data parity for A–C is **NOT VERIFIED**. Therefore `supabase migration repair` must not be executed until the full schema diff is reviewed and signed off.

## Forward-only sequence

1. Preserve registered files unchanged.
2. Reconcile A–C against catalog definitions and checksums.
3. Repair ledger state only after exact parity approval.
4. Apply D–F, `20260802160000`, then `20260802170000` on an isolated staging branch.
5. Run preflight, backfill/quarantine review, RLS/JWT and concurrency tests.
6. Promote only after all required gates pass.

The attempted transactional full-migration probe was rejected by the environment's risk controls and was not retried.
