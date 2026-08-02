# Migration reconciliation

Release decision: **NO-GO**

The connected Supabase ledger was re-read on 2026-08-02. It now records all
canonical versions `20260802010000` through `20260802180000`; the earlier
nine-version/A-C drift statement is **SUPERSEDED** for this project state.

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

## A-C catalog and seed comparison

Read-only catalog inspection on 2026-08-02 additionally verified the complete
A-C relation/column shapes, primary/foreign/unique/check constraints, indexes,
RLS flags, policies, configuration triggers and role grants. Seed invariants
also match: all four companies have production-state rows, every required
permission and company capability exists, and no duplicate capability key is
present.

Result: **A-C LEDGER RECONCILIATION IS NO LONGER PENDING** on the inspected
project. This does not validate the definitions or behavior of D-F and later
migrations, and it is not a production approval.

## Forward-only sequence

1. Preserve every registered file unchanged.
2. Apply only the new `20260802190000` emergency repair after explicit approval.
3. Run its postflight and Security Advisor before any later phase.
4. Continue datapreflight/quarantine, RLS/JWT and concurrency work only after
   the emergency access surface is actually closed.
5. Promote only after all Definition-of-Done gates pass.

The attempted transactional full-migration probe was rejected by the environment's risk controls and was not retried.
