# Independent retry / ACK / consumption review

Head: `95b5e391159e3164869ddabd8ec96b8f69189fe2`. Read-only source review; no repository edits, external messages, native suite or whole-suite reruns. Existing CI green was supplied by parent, not independently executed here. PR310 excluded.

## Verdict

The specific pre-finalization ERR-to-positive ACK defect is fixed by reservation. **One confirmed HIGH blocker remains on the complete persistence-to-billing path.** This finding is adjacent/pre-existing, not introduced by the reservation patch. No claim that full E035 or masterplan is complete.

## Confirmed: persistence-rejected E30/E66 quantities still reach metering and billing

Severity HIGH. Primary location: `lib/ediel/flows/utiltsDataRequest.part-2.ts:454-478,500`; sinks `:763-785`. Supporting locations: `lib/ediel/flows/utiltsDataRequest.part-1.ts:283-368,462,533-574,612-637,839-869`; SQL `supabase/migrations/20260923113000_ediel_utilts_ack_plan_reservation.sql:191-202`.

The SQL deliberately catches a series/value persistence failure and commits a transaction result with `processability_rejected`, `utilts_err`, `failed`. The caller updates `transactionDispositions`, but does not update `runtime.validation` or `ackPlan`. An otherwise valid message therefore passes the rejection branch at line 500. The data-request path acknowledges the outbound request, calls metering ingestion, and builds a billing underlay from the original normalized quantities. Both extraction and total calculation ignore the failed disposition and persistence result. Finally ACK creation observes the revised rejected disposition and creates UTILTS ERR. The sender receives rejection while rejected energy can be stored for billing. This also applies to one failed transaction among otherwise accepted transactions.

Concrete reproduction:

1. Use a valid matched E66/E30 with an eligible billing-underlay data request, customer/point and 123 kWh. Runtime validation is accepted.
2. Make one `meter_reading_series` / `meter_reading_values` insertion fail (a database constraint/trigger failure inside the function's guarded block). The RPC handles it rather than throwing and returns the documented failed transaction result.
3. The caller changes only its disposition; the accepted validation and ACK plan still allow the legacy ingestion branch.
4. Observe 123 kWh passed to both `normalizeAndStoreMeteringValue` and `ingestBillingUnderlay`, then an ERR ACK generated for that transaction.

Executed bounded proof: transpiled the actual `utiltsDataRequest.part-1.ts` in memory using installed TypeScript, loaded it into a VM with only external write dependencies mocked, and invoked its exported `maybeIngestMeteringValue` and `maybeCreateBillingUnderlay`. Input had T1=123, `processability_rejected/utilts_err`, and `persistenceStatus=failed`. Output was exactly `{"writes":[["meter",123],["bill",123]]}`. No source code was changed and no actual DB/customer records were written. Branch reachability in the actual caller was checked directly in the source. This is not an end-to-end DB execution claim.

Targeted fix: derive consumption eligibility from successful durable per-transaction outcomes; ensure extractors and billing totals never consume rejected/failed/held transactions or fall back to aggregate quantities containing them. Update the effective post-persistence runtime/side-effect decision before processing data-request completion. Add a processor regression with one SQL persistence failure and one accepted sibling asserting only accepted quantities can reach metering/billing, and ERR remains tied to the failed transaction.

## Previous finding: resolved

`20260923113000_ediel_utilts_ack_plan_reservation.sql:49-82` takes a transaction advisory lock before reading the result, reserves all non-held dispositions, and rejects changed disposition/response/issues before ACK creation can proceed. Only an unfinalized internal-review/none/not-applicable row can change. This prevents the previously described interruption after ERR draft creation but before finalization from becoming a positive retry. SQL regression covers precisely the missing-final-response window. Finalizer is reached after this RPC in both actual and nonbilling processing paths.

## Mixed held transactions / S07

A held sibling makes validation false; the early return at part-2 line 500 prevents legacy metering/billing of the entire batch. Accepted siblings still persist their series and can receive ACKs; held siblings carry empty RPC quantities and no ACK. S07 routes to the explicit nonbilling processor and does not call legacy metering/billing. Therefore the confirmed legacy-consumption finding above is E30/E66, not S07.

Changed fresh assessments for already reserved siblings still throw and roll back a whole retry, including any held sibling upgrade. This is a liveness limitation, not classified here as a second confirmed blocker: changing committed decisions is intentionally forbidden and a recovery/replay contract would need explicit definition. No evidence was found that the reservation lets contradictory ACKs through.

## Routing / scope / verification limits

Activated repository code-review, find-bugs, differential-review and fp-check guidance: full relevant execution path, concrete source-to-sink proof and explicit false-positive consideration. Read AGENTS and current memory (large historical sections were output-truncated); searched decisions/known failures. Narrow review rather than repository-wide security assessment. UI, hooks, supply-chain scans, broad performance, deployment and unrelated code changes skipped as out of scope. No new credentials/network lookups needed.

Fully read current reservation migration, transactionPersistence.ts, qualifyReceivedStructure.ts, utiltsInboundPolicyProcessor.ts and committed-retry SQL regression; read actual processing and legacy extraction/ingestion/billing/ACK sections in part-1/part-2. No whole-PR approval. Checked tenant/environment source assertions and service-role RPC grant; no confirmed tenant-isolation issue in this bounded path. No injection/crypto/session changes in reservation; concurrency lock is present. Confirmed integrity issue above survives checking the downstream extractors. No actual DB-failure injection or end-to-end ACK transmission executed; the bounded sink proof and actual caller control flow establish the defect without repeating broad tests.
