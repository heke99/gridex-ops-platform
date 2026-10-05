# Independent replacement calendar review

**APPROVE COMPONENT** at exact `0796a57181657d0c2b55dc4437f3ad5c6c8d88c3`, tree `2ac7762dd261c3b09e8bff83fecb118fb262decd`. This closes both concrete normalized-consumer defects independently reproduced at `3a22fbf6`. The complete correction is the primary owner's existing `resolution.ts` change from 3a22 plus 0796's declared-offset restoration in `timezone.ts` and `consumptionPreparation.ts`. No second implementation or owner-file changes were made by this reviewer.

Fetched exact commit directly from `https://github.com/heke99/gridex-ops-platform.git` into the clean detached `/workspace/gridex-primary-calendar-independent` checkout. All four changed files reviewed: new monthly test, two production files, and coverage evidence additions. Existing U-10 VERIFIED / AT-U-10 PASSED statuses are unchanged. The inherited main daily wire and grammar blobs match main9dc4a783 exactly. Exact SHA256 and Git blob identities are in the companion machine receipt.

## Actual path and preserved behavior

Actual exported runtime still computes local observation bounds and normalizes E66 transactions to UTC in `canonicalE66PersistenceTransactions` (`utiltsEngine.ts:752`). The production handoff (`flows/utiltsDataRequest.part-2.ts:487`) passes that runtime to `prepareUtiltsConsumptionContracts` before persistence. Preparation now restores each normalized absolute start into the validated DTM735 fixed offset before adding resolution (`consumptionPreparation.ts:74–76`), then converts the result back to canonical UTC through the unchanged `absolute()`/contract validator.

`edifactInstantInDeclaredOffset` (`timezone.ts:87`) preserves an absolute instant: rendering Date.parse(value)+offset in that same signed offset has the original epoch. This means fixed hour/day durations remain identical elapsed milliseconds. Months and years now operate on the declared local calendar; the signed formula also applies to negative offsets. Floating values and values with no declared offset return unchanged; empty values remain null. The sole production caller receives its timezone object from the existing format406 DTM735 parser, which permits only valid signed offsets through ±14:00 and minute00..59. The required-timezone guide rejection remains in place. This is a fixed-offset calculation, with no introduced host-timezone/DST guessing.

Source analysis confirms no changes to accepted transaction membership, physical quantity ownership/cursors, source quantities, tenant/customer attribution, billing capability, source admission, returned contract version, or persistence authority. The no-resolution path still uses the declared end directly. This review does not assert a new exhaustive yearly/negative-offset native matrix; those preservation conclusions follow the actual rendering/arithmetic and unchanged consumer gates.

## Independent asserting evidence

The original probe file is byte-identical (SHA256 `de091cf19ea8d9e0b0db38884ac1cee6a42316c896883b70d325611e0e9a0837`) and was executed once at 0796:

- July +0100 local Jul1→Aug1: actual consumer now ends `2026-07-31T23:00:00.000Z`, correcting its previous one-day-early end.
- November +0100 local Nov1→Dec1: actual consumer now ends `2026-11-30T23:00:00.000Z`, without its previous `observation_interval_unresolved` exception.

**2/2 PASS**, unchanged source-derived oracle. Wire parsing, actual source policy, runtime validation/disposition, UTC normalization, physical quantity membership and exported preparation are real functions. Only existing point/customer matching is a finite attribution port. There is no DB/source-admission receipt or authentic market fixture in this probe.

Fresh requested bounded suites: **24/24 PASS**, 3 files. Exact count is 4 new monthly runtime→preparation cases (Nov/Jul/Dec/Feb), 8 existing wire grammar cases, 9 existing daily runtime→preparation cases (fixed +0100/+0200, boundary dates and leap day), and 3 existing calendar helper cases. The owner's description of 18 existing cases is a counting slip; the actual existing file has 17, consistent with reported total24.

Commands:

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/primary-calendar-probe/vitest.config.mts --reporter=verbose
node node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-monthly-consumption-offset.test.ts __tests__/ediel-z06f-native-wire-grammar.test.ts __tests__/ediel-utilts-monthly-resolution-offset.test.ts --reporter=verbose
```

`git diff --check HEAD^ HEAD` PASS. Raw logs retained alongside this review, with hashes in the receipt. Existing original RED logs/probes and prior independent review remain intact.

## Whole-card qualification

Frozen U-10/AT-U-10 demand interval calculation from actual period, product and fixed timezone, explicit period counts including the 96-quarter fixed24h case, and prohibit universal96 or energy-sum completeness. This component proves the corrected monthly normalized-consumer interval bounds and relevant preservation; it does not independently rerun/reapprove every whole-card condition/prohibition. Existing interval-count/product/E66 count enforcement was read and the coverage evidence additions are appropriate, but its full asserting U-10 suite is not part of this minimum execution.

No native reception/persistence, source custody, external market approval, or exact composed-root approval is inferred. The owner's full10212 result was not independently repeated. Parent must compose the sole primary fix with current main and obtain fresh required exact-head native/capture/CI gates. No remaining confirmed blocker in this calendar component.

Skill routing: bounded independent spec/caller review, differential review, direct unchanged-probe verification. No production remediation, new agents, shared memory mutation, broad scans, schema/authorization changes or repeated heavy harness.
