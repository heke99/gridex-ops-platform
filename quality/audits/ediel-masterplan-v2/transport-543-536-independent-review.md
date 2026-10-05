# Independent transport component reviews

Reviewed 2026-10-05 UTC by `/root/ten07_rule_review`. Sole source authors retain implementation ownership. Detached isolated checkouts; no owner source, tests, coverage, shared memory, grants, workflow or GitHub edits. No external SMTP/IMAP, credentials, source publisher, native replay or full suite execution.

Exact changed-file Git blobs/SHA256, clean status, trees and log hashes are retained in `/workspace/agent-review-checkpoints/transport-543-536-independent-receipt.json` (SHA256 `fdfc54d04d541082b7147855e428eabc9ae032b530a876060be0bda77f7566bc`).

## #543 — TR08 relay trace

Exact HEAD `9d69e5892db18f451245a0ab7102a9a67bedeaca`, tree `188dbefbf64f7ef0b49a59f5301c35242f515a81`, diff from main `56192d16`. **BLOCKED as an authoritative all-hop TLS/SPF verifier; partial storage/parser behavior works.** The rule row correctly remains PARTIAL; the actual component exposes acceptance paths that do not establish the claimed transport truth.

All changed source, migration, launcher, local tests, finite SQL regression, native-fixture delta, coverage/memory deltas and capture-import metadata were reviewed. Existing readiness/UI and transport-exception caller/authority paths were traced.

| Frozen TR08 / AT-TR08 effect | Actual owner/caller evidence | Verdict |
| --- | --- | --- |
| Verify relay TLS and SPF | `verifyRelayTrace` reverses Received headers, detects submission host, parses TLS markers and SPF strings; `relayTraceReadiness` rechecks original hash and age | Partial: headers are parsed but trusted receiver identity, chain custody and source-bound SPF sender are absent |
| First-server TLS does not prove subsequent hops | Existing tests reject a plaintext ordinary relay and weak TLS; real SMTP launcher requires authenticated TLS1.2 to submission host | Positive bounded behavior, but remote LMTP/plaintext and disconnected chains still return verified |
| Check provider policy and actual delivery trace | Launcher can send a tagged synthetic message via configured SMTP and read headers via authenticated TLS IMAP; injected tests assert send/poll/persist wiring | No provider-policy source or consumer. No genuine delivery trace executed. Public record API also accepts independently supplied raw bytes/verdict without protected probe/send/read custody |
| Do not declare entire transport verified from port465 | Live page calls `getMailReadiness()` without evidence; new warning explicitly says TCP is only reachability | This prohibition holds for the default live page. Optional supplied record can still produce an unsupported all-hop VERIFIED diagnostic |
| Source/current company/environment authority | Service-only public record/read RPCs call existing current `communication.write` actor owner; private table ACL/RLS and original hash/immutability | Storage isolation is distinct from source truth. Trace is not bound to configured SMTP account/provider/policy, sender, route or intended receiver |
| Exceptions may depend only on actual qualified transport evidence | New insert trigger checks matching company/environment, stored verified bit, trace hash and 30-day record time | Actual approval accepts a forged SPF verdict over an original with no SPF field. The trigger does not prove the trace describes that approval's receiver/route; original read-back time/custody is not retained |

Confirmed bounded findings:

1. **Receiver SPF authority is absent.** `verifyRelayTrace` accepts the first `spf=pass` from any Authentication-Results or Received-SPF field. It never qualifies `authserv-id`, binds the authenticated receiving boundary, or matches the tested envelope sender/domain. A direct actual call returned `verified:true`, `spf:pass`, `reasons:[]` with `Authentication-Results: attacker.example.invalid; spf=pass smtp.mailfrom=unrelated.example.invalid` placed before the real receiver's `spf=fail`.
2. **All-hop classification can erase a remote plaintext transfer.** Every LMTP/LOCAL protocol or literal loopback `from` after own submission is designated mailbox_internal without a trusted local topology boundary. Actual `Received: from relay.example.invalid by mx.receiver.example.invalid with LMTP` was excluded despite `tls:false`; with an earlier TLS relay the verdict is verified. A separate disconnected `from`/previous `by` chain also verified. No chain continuity proof exists.
3. **Actual public database consistency does not validate original SPF.** `consistent_v1` checks verdict SPF equals pass, but never reads original Authentication-Results/Received-SPF, and trusts caller-selected hop roles. Executing the actual public record facade under service_role plus a current permitted actor, with a correctly hash-bound original lacking Authentication-Results and a claimed positive verdict, succeeds. The actual protected publisher then passes the new approval trigger using that trace hash. This is a reachable actual admission effect, not merely a generic helper concern.
4. **The live readiness consumer is disconnected.** `app/admin/ediel/mail-readiness/page.tsx:68` calls `getMailReadiness()` with no trace; the new read RPC has no production caller. Supplying a record is demonstrated only in local tests. Stored evidence never reaches the actual UI; the UI remains honestly unverified, including after a successful operator record.
5. **Provider policy and exact transport scope remain unproven.** The launcher shares environment SMTP values but does not use the existing SMTP readiness/config enforcement or establish authenticated configured-provider policy. A trace to the operator's test mailbox is not bound to an approval's route/receiver, and storing arbitrary header bytes through the public service facade is not proof those bytes came from that mailbox. No deployed privileged publisher was invoked or introduced by this review.

Normative basis: retained transport T PDF SHA256 `5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951`. §3.1 requires protected SMTP-server connections for applicable automated Swedish traffic and SPF verification of the stated sending domain; A2 requires TLS1.2+ unless bilaterally qualified, with CA-issued valid/nonrevoked certificate. These findings do not invent a new attestation schema or require that arbitrary headers be cryptographic evidence. They demonstrate that the current consumer lacks the actual source needed to make its positive claim.

Executed bounded evidence:

- `vitest run __tests__/ediel-tr-08-relay-trace.test.ts --pool=threads --maxWorkers=1`: **11/11 PASS**. DNS/TCP/send/fetch/persist inputs are finite mocks; no network/mail occurred. Log `/tmp/tr08-543-independent-pure.log`, SHA256 `4510f8e9365c71672587116323ffc8c2d37b6724e05e847a2b021e5c73b4694c`.
- Read-only actual exported TS calls on three declared synthetic header inputs, using Node strip-types, returned verified for untrusted SPF pass before receiver failure, remote plaintext LMTP, and disconnected chain. Log `/tmp/tr08-543-independent-edge-verdicts.log`, SHA256 `b218a115c436d38b6a00d8f4825cd0728f673a660daf0d89f4f01d9409b8d267`.
- Single execution of existing `ediel-tr-08-relay-trace-sql-regression.mjs` in PGlite: original **15/15 PASS**, plus read-only in-memory diagnostic invoking its actual public record + actual approval trigger with original SPF omitted. Actual TS verifier returned `spf_absent`/false; record and approval both succeeded with the claimed positive verdict. No repository file changed. Log `/tmp/tr08-543-independent-sql-boundary.log`, SHA256 `441013f8766d211e4d1c66a31e328d3200ef7e820557ba112b7673c7c79ca73c`.

The SQL fixture explicitly uses a synthetic upstream canonical boundary and predecessor mutation ports. Actual actor/permission functions, source/publisher/approval owner, relay recording/read/consistency/immutability/trigger functions execute. It proves these bounded local effects, not native catalogue/replay parity or market custody.

The imported three generated artifact hashes match the author's retained capture receipt. The receipt declares capture-only, source `592c558d`, native/browser/type comparison/parity NOT_RUN. Its raw ZIP was not supplied or independently verified in this task; no authentic capture/native approval is inferred from matching repository outputs.

Minimum source-backed next action belongs to sole #543 author: identify the actual configured Strato policy and authoritative receiver/SPF/header format, bind retained read-back provenance and relevant sender/route/receiver, then qualify which received headers/topology facts are trusted before treating a positive parse as verification. The existing retained IMAP original/custody mechanisms are candidate integration owners; they should be traced/reused, not replaced by a new arbitrary attestation or publisher. Wire the actual permission-scoped read into the existing readiness consumer only after that source contract is defined. Add meaningful counterexamples at the actual TS and public SQL consumers. Keep PARTIAL/unproven while those predicates are absent.

### Prefix/history composition

Actual new migration is `20261004190000_ediel_tr08_relay_trace_evidence.sql`, SHA256 `2e0320dbce6e9d7bb503df6ae1d73bd03a95b84e767f86b50ce965f6e26bb9f4`. No P08 migration with that prefix was found in the exact reviewed primary3a22 tree or inspected primary/review copies. A present filename/version collision is **not proven**.

`check-migration-versions.cjs` and clean replay both permit explicitly checksum-pinned exact timestamp groups and reject an unlisted duplicate group. Current allowlist has no `20261004190000` group. If pending P08 later publishes the same prefix, composition must either retain a deliberately approved exact group and both checksums or use sole owner-coordinated naming before application, then obtain authentic composed capture. Shared prefix alone is not intrinsically invalid, and no disjoint function/object collision was established from the unavailable pending source.

## #536 — TR09 production S/MIME for every family

Exact HEAD `a37830b3adb0f13bcf73753551d589bc33c8c9d9`, tree `3ece31490fbc90a835a1414e5906e5d17f3053c5`, diff from main `56192d16`. **APPROVE bounded all-family production encryption-enforcement component.** No concrete component blocker found. This is not whole TR09/AT approval or native replay approval.

All changed source, forward SQL, tests, coverage/status/policy/memory changes and pending schema metadata were reviewed. Actual send/preflight/exception capability/certificate/persistence callers were traced.

| Component effect / relevant frozen TR09 predicate | Actual implementation and asserting evidence | Decision |
| --- | --- | --- |
| No general production plaintext switch | `applyMessageFamilyEncryptionPolicy` in actual transport and preflight preserves production S/MIME for every family; legacy `allow_unencrypted_production` no longer authorizes production plaintext | Covered in actual preflight and helper tests for 8 families; confirmed source callers |
| Plaintext MIME override cannot escape policy | Actual send checks effective mode before packaging and final MIME afterward; preflight resolves override then blocks | Actual helper/preflight and source trace cover override; native SMTP path not rerun |
| Database boundary refuses production plaintext outside exact reserve | Forward `stage_v1` checks persisted outbound production row for all families and formats, independent of caller family flag | Actual final stage function tests cover 5 families plus non-EDIFACT refusal and 3 encrypted/test contrasts |
| Use only existing specified exception cases, current authority and scope | Existing `source.ts` authenticates exact DB-returned authorization into a WeakMap capability; SQL reader rechecks original, actor, route, current namespace, case, time and revocation; no source function changed | Preserved. PRODAT-only reserve matches T §3.1/A3; no new non-PRODAT exception was invented |
| Continued mandatory TLS on plaintext reserve | New helper is the extracted unchanged route/TLS guard. Actual SMTP implementation enforces TLS independently; existing source requires exact TLS evidence | Guard finite cases pass. All-hop external source remains separately qualified; this helper alone is not all-hop verification |
| Separate deviation journal, alarm and bounded operation | Stage retains operation insertion, prepared event, administrator mandatory-TLS alarm and 1–3 attempt budget logic; enter rechecks authority | Actual stage tests assert journal/alarm/budget and forged/invented rejection with explicitly finite protected-read upstream port |
| Preserve previous-CRL reserved path and ordinary certificate protections | No diff to `source.ts`, `previousCrl.ts` or certificateTrust; CRL case remains S/MIME and TLS. Actual scoped resolver executes inside existing current capability context | Compatible with sole #545 crypto change; whole CRL proof pending that owner's fresh actual run |

Executed command: `vitest run __tests__/ediel-tr-09-production-smime-all-families.test.ts __tests__/ediel-tr-09-transport-exception-stage-db.test.ts --pool=threads --maxWorkers=1` — **2 files, 46 PASS, 0 failures**. Log `/tmp/tr09-536-independent-targeted.log`, SHA256 `b0ca1e662580bbded0dbc5b2e9353a106c5128b39d388534c1ee09a44891a339`.

The 34 TS cases call actual policy helpers and actual preflight with finite DB route rows. Eight first guard cases are family-labelled calls to the family-independent guard; they are not eight actual public sends. The 12 SQL cases load the actual final stage body and actual case function with a declared finite authorization read/table fixture. They assert real stage writes/denials; they do not prove source publication, real TLS, CMS crypto, native leases, API custody or provider entry.

Source T §3.1 requires PRODAT S/MIME, excludes associated ACKs from that requirement, and allows bilateral encryption for other families. The broader production S/MIME rule is an explicit separately recorded owner policy in this component, a stricter local requirement rather than the literal text of T. The unchanged PRODAT-only exceptional source does not create an invented reserve for the newly hardened families. Non-EDIFACT production remains fail-closed because actual S/MIME packaging supports EDIFACT only; this component does not claim a new XML-S/MIME implementation.

The ordinary orchestrator still has no reserve-selector integration; this predates the component. Its preflight and direct send remain fail-closed. The reserve path remains the existing protected selector into actual SMTP consumer, with no new manual approval authority. This review does not require or introduce a parallel API, reserve source or helper.

### Compatibility with #545

Inspected exact public `1c6a5decf726d87d6d0070d3a1a37abd85b73414` via local verified Git source, and local proposed `a1378a7b5f55d0ff73e29b5301750a7069eaf81e`. In the relevant transport authority surface their sole delta is `previousCrl.ts` requiring exact OpenSSL `verify OK` stderr plus empty stdout, instead of accepting process exit status alone. The proposed blob SHA256 is `cbef40c3fd84be9b12e15d707f67eef32fe499296a40ceb3db887401267d31e3`; no #536 policy, stage or protected-read signature is changed by it. Root reports independent existing crypto7PASS; this reviewer did not duplicate that execution. Published old native13 is 12PASS/1FAIL and cannot approve the whole card. Fresh current native13 after the sole crypto fix remains required; unresolved primary calendar code must not be reused as qualified evidence.

The #536 manifest deliberately states `composition_capture_pending:true` and schema.sql contains a one-line handpatch awaiting authentic replay. That pending gate is retained; current bounded component approval does not validate handpatched schema as an authentic captured artifact.

## Preserved ownership and skill routing

Relevant full caller/differential/spec review, direct refutation, targeted local verification and Supabase ACL/RLS/source-boundary guidance applied. No performance/UI/schema remediation, security scan, dependency install, subagent, broad audit, external mail or deployment was needed. Own checkpoints only were written; exact primary3a22 reviewer file/probes remain intact. Parent retains publication and whole-card/native decisions.
