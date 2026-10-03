# Ediel masterplan v2 — code verification 2026-10-03

Baseline main `b03303cc`. All 352 IDs (121 rule cards, 231 acceptance contracts) re-checked against the frozen spec, cited and newer code, with locally runnable tests executed. Item detail: `masterplan-v2-code-verification-20261003.json`. Percent = estimated share of specified behaviour built and tested in code; it is **not** formal acceptance or market activation. `coverage.json` statuses are unchanged.

## Result

| | complete_code | partial_code | no_implementation | avg built |
|---|---|---|---|---|
| Rule cards (121) | 3 | 110 | 8 | 45 % |
| Acceptance contracts (231) | 10 | 203 | 18 | 41 % |

Rule-card average per area: ENV 57, P 57, ACK 56, OPS 53, U 50, TR 46, DB 43, IMP 42, GOV 41, AI 37, ESCO 30, TEN 28 %. No verdict changed since the 2026-09-27 traceability; PRODAT header work (202/204/205/206/313) adds partial evidence to ACK-02/ACK-10 only.

Largest open gaps: beneficiary/data-access grant model (TEN-03/08/09/10/14, no code); ESCO 21-day Z13 repeat timer, Z15VH, scoped market permission (ESCO-06/11); ACK correlation key lacks market/role/environment/family (ACK-06), fieldless ERC41 default (ACK-04), no incident/correction flow (ACK-07); UTILTS 1 MB/999 packer (U-16), S06 still active (U-07), E90/E98 on E66 (U-11); certificate status `Math.ceil` and no not-before/revoked check (TR); sent-copy and DSN Final-Recipient (TR-11).

## Tests

- 232 Ediel vitest files, 5 281 tests: pass. Masterplan integrity check: pass.
- `scripts/test-ediel-*.cjs` need `node --experimental-vm-modules --test` (as in CI); they pass that way.
- Not runnable here (need native Supabase/psql): `scripts/ediel-source-owner-native.test.ts`, `scripts/ediel-z04-ack-native.test.ts`, `scripts/ediel-correction-context-native.test.ts`, SQL regressions.

## Failing regression scripts on main — triage

Repaired in this change (stale: files split in #385 or fixture in wrong source shape; guarded behaviour verified present in code):
`ediel:rule-regression` (Z14N fixture placed CCI/CAV after RFF and used a field-223 code as 322 status; rewritten in source shape), `ediel:canonical-consolidation-regression`/`-verify` (8 checks now follow the canonical facade; Z04C asserted via its vitest case), `ediel:inbound-tenant-resolution-regression`, `ediel:utilts-reason-regression` (dead `utiltsErr.ts` list check dropped, removed in 226ffa1e), `ediel:company-route-materialization-regression`, 10 of 12 checks in `ediel:z13vh-regression`, `gridex-z01-customer-info-linkage-regression`, `gridex-actor-registry-intake-hardening-regression`.

Open, for the masterplan owner: `ediel:z13vh-regression` still fails two checks — the Z13VH/S17 reason mismatch guard (`z13vh_reason_for_transaction_mismatch`) no longer exists. Likely intentional under F3 (S17 with fixed report end is allowed; `__tests__/ediel-prodat-date-consumers.test.ts`), builders still force S18 for VH. Decide: drop/rewrite the two checks and update `docs/ai-context/05_PRODAT_RULES.md:235`, or restore a guard consistent with F3. Side note: `shouldMaterializePerGridOwner` (`lib/ediel/flows/routeMatrix.ts:80`) does not reject an unknown PRODAT code.
