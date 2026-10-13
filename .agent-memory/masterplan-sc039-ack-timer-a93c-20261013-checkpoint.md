# SC039 ACK timer component — a93c

Source/base: efed3683115c06d1925f8b80c05c801a54db9885; base tree dc439c2e017a9633471db53919b745f587abb67b. Branch: codex/sc039-ack-timer-a93c-20261013.

## Custody and requirement

Receipt 0ed3db29985ab1b659aa2eb11ec295bcbae7b294 uses the exact main tree and single main parent. Authenticated absence, active writer/open-PR checks, atomic create-if-absent and GET_MATCH for all three paths preceded source/test writes; CLAIM #766/6145258874.

Own exact paths: lib/ediel/sla/ackTimerCompletion.ts, lib/ediel/sla/checkAckDeadlines.ts, __tests__/ediel-sc-039-partial-ack-timer-completion.test.ts. This unique checkpoint needs no shared-memory custody. No whole ID, slot, ledger, SQL, GEN, native, backend, original collector or merge custody.

Frozen SC-039 expected: “Bevara båda meddelandena och deras orsakskedja. Eventuell intern väntan måste hålla föreskrivna kvittensfrister; annars krävs rätt externt utfall eller kontakt.” This component preserves deadline monitoring; it does not establish the entire reversed-order cancellation contract or perform external contact.

## Cause and correction

Partial cancellation application can emit an object ACK for one committed object while a sibling waits for its exact original. The old non-UTILTS projection resolved the entire APERAK timer on any sent application ACK. Three actual modeled helper/sweep controls and a separate caller/native-authority refutation confirmed that loss of monitoring.

The PRODAT projection now unions physically source-qualified first-register object outcomes using existing readPhysicalAckSourceCorrelation. Every actual object must have a sent positive or negative response. The deadline sweep selects source direction and ACK raw bytes. Missing/foreign/ambiguous responses leave the deadline active. Genuine whole-header negative completion uses the existing durable source binding and physical negative whole-message response, including malformed originals; its source relation still depends on protected creator/send authority. Technical rejection and UTILTS completion are unchanged. No new protocol decision, migration, producer or ledger promotion.

## Executed verification

- Valid baseline RED: 30 cases, 13 pass and 17 fail before product writes. The first exploratory RED had a modeled select-whitespace bug; retained separately and not used as the valid RED.
- Targeted GREEN: 30/30 pass, including all five unchanged completion controls.
- Affected GREEN: 55/55 pass across the new partial test and unchanged timer completion, deadline race, ACK source correlation and SC054 storage-failure tests. Exit 0; retained JSON and tool config.
- Earlier affected attempts 1–7 could not collect SC054 in the isolated dependency setup; other 50 assertions passed. Those collection failures remain retained and are not reported as green. Resolution used only scratch dependency aliases, with no source/test assertion weakening.
- Strict helper semantic TypeScript graph check and git diff --check pass. This is not the full application typecheck.
- Host Node 24.19.0, Vitest 4.1.9, TypeScript 5.9.3. Tests use declared modeled storage/ports; SC054 includes its existing PGlite component. No native/backend/GEN/capture, original collection, real transport, customer or production effect. Mandatory current-head CI on project Node22 is still required.

## Review and next action

Skills applied: systematic-debugging/TDD for cause and RED/GREEN; code-review/differential-review and spec-to-code/fp-check for literal scope and refutation; verification-before-completion; requesting-code-review for two fresh noncoauthor peers. No UI/performance/standalone API/Admin or global security task. Root authored code/tests and cannot count as an independent final reviewer.

Two fresh read-only final peers are sc039_final_peer_a and sc039_final_peer_b. Their final assessments must bind the exact final commit/base/tree. Publication coordination is requested on #766/6145258874 because the SLA path matches existing native workflows; no unqualified duplicate producer or blind rerun is authorized. The existing serial main merge owner remains responsible for normal merge after qualified proof, both final peers and all mandatory current-head gates.

Next: obtain exact final peer receipts, resolve producer publication routing, publish the bounded source PR once, follow actual current-head gates and serial normal delivery, authenticate PR state/ordered parents/tree/current ledger, then release only the three own receipt-matched file refs. If routing remains blocked, preserve this local source and custody with a precise handoff; do not infer silence as clearance. SC031 remains a separate C1 file handoff; prior denied report/private DB05 publications are not bypassed.

- Retained candidate-red2 JSON SHA256 580930dfaec207f2cb12a63a730237c6b8ec0ff943b7f39268ccdb08db8cde79: 13/30 passed; success false.
- Retained candidate-green JSON SHA256 53880b5542f410fa53b9447ef98bd518c6222972174a56c60c498ee76fee7866: 30/30 passed; success true.
- Retained affected8 JSON SHA256 841348bf7cffa21393580970dff655de3f6f40a1472aa14ac743bb80a5d15887: 55/55 passed; success true.
