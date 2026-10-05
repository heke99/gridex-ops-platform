# SC-037 — independent static refutation

Independent agent `/root/sc037_refutation`, read-only source01b11f55. No runtime reproduction, file edits by the refuter, native harness or coverage approval. Root preserves the delivered conclusion and verifies the referenced inputs.

The candidate survives, narrowly: the second cron sweep can complete a valid switch and alter site/point projections before the immutable start. It does not directly activate customer_supply_periods.

Cron route101–103 runs exact supply deadlines;122–126 then runs legacy ready-switch processing, scheduled every five minutes (vercel42–43). Schema40642–40648 selects normal confirmation only at market_start_at<=now(); preceding21594 handles ending or regulated supply, not a future ordinary confirmation. Actual normal Z04 creates accepted switch and exact confirmed period (normal-source migration130–136; mixed154–160). Legacy candidate76714–76719 and finalizer65607–65622 use Stockholm DATE. Writes65666/65679/65690/65704 change site supplier/status, point status, switch completion and execution_completed event.

Valid original202610200000 uses fixedUTC+1, immutable start2026-10-19T23:00Z. At22:01Z Stockholm DATE is20, so first sweep holds while legacy predicates pass. Actual producer uses source DATE→0000, not an arbitrary invented minute. Frozen prodat_fields350–357/ENV08 rules518–520 and renderer dates42–47,80–85/schema permission_time25231–25242 establish the fixed offset.

Attempted refutations:

- Z04 guard63482–63548 requires own inbound original and accepted state, but only the same Stockholm DATE; no exact-period start witness.
- Dispatch68539 returns for completed state.
- Geography migration20260825112000:98–119 allows unchanged bindings; candidate preserves non-null grid/price. Provisional selector20260824080448:27–31 returns for non-null owner.
- Correction7081–7174 captures owner-bound facts without exact-start gate.
- Non-partner metadata avoids partner emitter. Customer summary80925–81000, billing revision59871–59930 and depth-gated reaggregation79235 have no start gate. An untombstoned valid customer passes retention; same tenant/customer/site/point/contract graph preserves FKs.
- No later migration redefines either legacy activation function; effective schema matches20260903090000_atomic_supplier_switch_activation_sweep.sql.

Premature completed status may then fail canonical accepted-state requirement33164. This is a static consequence, not observed canonical activation/period/billing mutation. Existing pure helper’s22Z readiness is not genuine wire0000/23Z proof. Retained owner must run the whole cron sequence on the same actual Z04-created UUID, actual isolated DB time before/at start, all own/unrelated effects and valid/invalid contrasts. Source/currentness/replay checks and clock qualification remain in existing native/source lane.

## Independently read input SHA256

```json
{
  "supabase/schema.sql": "df4a353f3f2bb1bfd4eb0f4be99c76ee89a65ffb98bdc345f78c6924e5e65df6",
  "supabase/migrations/20260903090000_atomic_supplier_switch_activation_sweep.sql": "8d6d8f8bb7e19e4ecf7b0a4e0ffce68eca923b66c00449bbad13e36a6949462a",
  "supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql": "c9b05a063c742d96fcb1521756859d92ffc3b3766cd949ad9103b83fa429df4d",
  "supabase/migrations/20260930224726_ediel_prodat_mixed_own_object_processing.sql": "14cbfc9d62b94e441b396f76d5b39a1357391e07aceaf05c6f069cab22dd3ab5",
  "supabase/migrations/20260825112000_ops_precision_resolution_authority.sql": "3f3549adffd87fcc1bd9d6811189734e57b2c6317442506f0f762bfcb84432d8",
  "supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql": "6d45152f5fb419d3ca52468312b4986acf96cfe6301dc34f20aaa284c99d6580",
  "supabase/migrations/20260816170000_partner_api_v1_canonical_surface_events.sql": "1faa62377d47df7159ccf5440d4dbee44acd12860d440a19b80b643a4fcd6a4b",
  "lib/operations/supplierSwitchActivationSweep.ts": "210e123b5303efc6ea6bc08001bf51caffb97dfd653cb297d1efa6246a038828",
  "lib/ediel/flows/supplyMarketTransition.ts": "584e51953ca5da03ad9d216ce8e0e88cc09720b5dd1e7e8f6bcc7e4ec5995829",
  "app/api/internal/customer-operations/cron/route.ts": "4de673ccb8d9bd2656b594ee368d723926a8ca084b145e22f03c1b7f461a9d30",
  "lib/ediel/prodat/compatAdapter.ts": "731278945699538b10ea70f49426fe20f6c034efdd3cb47c3fbb0bf84d1b8537",
  "lib/ediel/prodat/render/dates.ts": "25b2cd8c56b4cb7c824c6ed6c6ecc8783b8843212387f4cb08223fc157b40505",
  "__tests__/ediel-sc-037-future-start.test.ts": "580a3323677a3a9b7b734469ea32f11e37752c2c6799bde34a62e895a64856bf",
  "docs/ediel/masterplan-v2/registers/rules.json": "48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8",
  "docs/ediel/masterplan-v2/registers/acceptance_tests.json": "e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10",
  "docs/ediel/masterplan-v2/registers/prodat_fields.json": "e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354",
  "vercel.json": "361654d81ebcb17ea8b3f7a8a851e2cf674d903fed7f99b34ef42de14cc7aef3"
}
```
