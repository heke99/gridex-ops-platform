# E058 / GOV-03 — APERAK source-profile correction

Base: `main` after PR #318 (`407e273e1f8b99597afd8c108410a10bf95c109d`). PR #310 remains paused and is not imported.

## Source requirement

Masterplan finding E058 states that `26.A/16.B` in the PRODAT document denotes electricity/gas PRODAT scope, not a generic APERAK revision. GOV-03 requires APERAK to be selected from the original message family and forbids treating a generic APERAK profile as a replacement for PRODAT- or UTILTS-specific acknowledgement rules.

## Defect reproduced

`guideRegistry.ts` published a standalone `APERAK` guide with `guideRevision: '16-B'` and electricity association `E2SE6A`. `versionSelector.ts` then converted runtime APERAK `16B` into `APERAK:D:96A:UN:E2SE6A`. That made a GAS PRODAT label act as an APERAK version authority even though the actual renderer already distinguished PRODAT-origin and UTILTS-origin APERAK wire profiles.

## Correction

- PRODAT-origin APERAK is bound to the effective PRODAT 26-A source profile and `E2SE6A`.
- UTILTS-origin APERAK is bound to the effective UTILTS source revision (`25-A-3` before 2026-10-01, `25-A-4` from 2026-10-01) and `E5SE5A`.
- Generic APERAK version selection without a known source family now fails closed.
- Inbound APERAK may use the actual UNH association (`E2SE6A` or `E5SE5A`) to select the source-bound guide when internal source metadata is unavailable.
- Legacy `16B` is no longer accepted as an APERAK identity.
- Existing wire renderer behavior remains source-specific: PRODAT acknowledgement uses `APERAK:D:96A:UN:E2SE6A`; UTILTS/UTILTS_ERR acknowledgement uses `APERAK:D:04A:UN:E5SE5A`.

## Evidence

`__tests__/ediel-aperak-source-profile-regression.test.ts` covers source-specific guide selection, the September/October UTILTS boundary, correct P/U wire tokens, and fail-closed behavior when the source family is missing.

`scripts/gridex-aperak-canonical-evidence-regression.cjs` now rejects reintroduction of generic APERAK 16-B authority and checks that both source-family profiles remain represented.

This closes the identified code/configuration defect only. It does not by itself certify every APERAK field, every TGT case, live market acceptance, or paused PR #310 database/schema/types work.
