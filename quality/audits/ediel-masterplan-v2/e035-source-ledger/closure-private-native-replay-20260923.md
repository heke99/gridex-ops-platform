# E035 private closure-wire checkpoint — native replay

Candidate: `46efcdea82d1093fb63619f09ecb0b13b3dcfe30`, tree `478f4b1aad989f0951ada1860c1a03a4f1b5db38`.

GitHub Actions OPS run [35855300600](https://github.com/heke99/gridex-ops-platform/actions/runs/35855300600), native job `107162230371`, rebuilt an empty disposable PostgreSQL 17 database with pinned Supabase CLI 2.101.0. No hosted project was mutated.

- Forward migration `20260923113014_ediel_closure_original_wire_binding.sql` applied.
- Actual native closure-wire suite: 37/37 PASS; retained structural source-owner suite: 17/17 PASS.
- Retained committed-retry SQL checks: 8/8 PASS; source-object decisions: 71/71 PASS.
- Tenant invariants and injected-drift parity self-test PASS.
- Public generated types are byte-identical to committed types, SHA256 `6af55fbbed9390acfe71dbb8c757c10e3a021dec15842df801d06b679d98eda9`.
- Job concluded FAILURE at final schema comparison: three newly added private functions and corresponding grants were absent from the saved snapshot. Separate verify and E2E smoke jobs also failed the stale migration-tail manifest guard. These are actual failed runs, not whole-CI acceptance.
- Quality release gates, browser, Ediel contract, tenant workflows and full E2E coverage job passed. The E2E workflow itself failed its smoke/certificate gates.

Artifact `10747266416` (`gridex-rem-002-clean-replay`, four files) was downloaded via GitHub and its archive SHA256 verified as `7ff39cb9ce38f62abde3d4a7387d66d7ef18420dd9ec0b8fa31956b1ac43ea7d`. `supabase/schema.sql` and `supabase/schema.fingerprint.json` were copied verbatim from its `rem002-schema-snapshot` directory. Actual schema fingerprint: `bd890baedae40488e218c7458f1e51f2d227e57e146066751d68d5d8f898b74c`. The types manifest now records this generation and migration tail; no generated types were edited. Local generated-types guard passes after reconciliation.

This proves the bounded private parser checkpoint only. The closure approval producer, append-owner binding, immutable readsets, timeline selection and UI still need implementation and native qualification. The independent review's marker-environment type finding also requires its scoped fix review. No whole E035 acceptance or merge is claimed; main and paused PR #310 remain unchanged.
