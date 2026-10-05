# Successful UTILTS replay quantity binding — narrow independent review

Reviewed working tree at HEAD `146b0a242ba6a2c5355f9211b6937cf1f2396915`, including current pure-projection correction in part-1. Read-only repository review; no hosted writes, source edits, broad tests or subagents. Code-review/differential-review/fp-check approach continued from prior review. The implementation report's disclosed limitation is **confirmed HIGH**, not merely hypothetical immutability uncertainty.

## Concrete source-to-sink path

1. **There is an actual raw replacement writer.** `lib/inbound-mail/inboundStatusUpdater.ts:40-78` finds an existing inbound source by email ID, or company/sender/receiver/interchange reference. It does not compare raw bytes or their hash. `:373` includes `raw_payload: input.parsed.rawPayload` in its update data; `:411-428` updates the existing row. A second inbound envelope with the same interchange identity and changed QTY can therefore reuse the source ID. `lib/inbound-mail/edielInboundProcessor.ts:253-277` calls this writer on its ordinary non-ACK path. A later ordinary source-ID processing/retry reads this changed row. This review does not claim that every email automatically triggers that retry immediately.
2. **No universal UTILTS seal blocks it.** The current contract trigger (`supabase/schema.sql:47236-47313`, originating in forward `20260921224255_ediel_inbound_prodat_receive_context.sql`) automatically hashes inbound PRODAT and canonical outbound messages. Inbound UTILTS with null `immutable_payload_hash` has neither rule; the generic update guard is conditional on an already nonnull old hash. Ordinary inbound writer does not populate that hash. Schema also permits authenticated company writers to update `ediel_messages` (policy at schema line 99543, restrictive company-write policy at 109855, table grant at 111408), so this is not solely a database-superuser mutation scenario.
3. **Processing reads new bytes.** `lib/ediel/db.ts:560-576` returns the current row without a source-hash check. `lib/ediel/flows/utiltsDataRequest.part-2.ts:352` uses that reader. `lib/ediel/utiltsEngine.ts:465-502` invokes the actual runtime, and `utiltsEngine.part-1.ts:1612-1615` parses `message.raw_payload` afresh. Pick an otherwise valid E30/E66 transaction whose changed QTY remains valid and whose structural decision is unchanged (e.g. exempt valid high-resolution energy, or unchanged approved structure).
4. **SQL successful replay ignores quantities.** `20260923113000_ediel_utilts_ack_plan_reservation.sql:60-81` compares only disposition, response type and issue codes; for a persisted row it returns the old series ID and `idempotentReplay:true`. It never loads/compares that series' `raw_transaction` or `immutable_hash`. Those are available from the original insert at lines 146-157.
5. **New sink gate accepts the old status for the new quantities.** `lib/ediel/flows/utiltsDataRequest.part-1.ts:289-303` checks unique transaction IDs and accepted/persisted status. It does not bind quantities to series/hash. Gated extraction then flattens the newly parsed quantities. Both legacy sinks consume that output.
6. **Downstream storage does not restore binding.** `lib/metering/normalizeMeteringValues.ts:184-218` passes new quantities to `gridex_ingest_metering_value_atomic`. That function (`supabase/schema.sql:27875-28004`) checks tenant/customer/point and ordinary duplicate quantities; changed quantity under the same canonical key creates a replacement revision at 27941 onward. It does not compare the immutable UTILTS series. Thus a completed first ingestion does not neutralize the risk. A crash after series persistence and before legacy ingestion makes the first legacy write wrong instead.

## Reproduction / observed bounded evidence

- First process source M / transaction T1 = 123 kWh; retain accepted/positive/persisted row and series S. Interrupt before legacy ingestion/billing (or allow ingestion to complete).
- Replace only the valid QTY under the same interchange/source/transaction identity with 999 kWh using the actual inbound writer, or an authorized company update of an unsealed UTILTS row.
- Retry M with unchanged valid acceptance. The SQL branch returns S unchanged, with successful replay status.
- New normalized T1=999 plus old successful result passes the sink gate. Metering receives 999; a not-yet-created billing underlay receives 999. If an underlay already exists its separate ID guard prevents creating another, but metering can still be revised. The immutable series remains 123 and the reserved/possibly finalized ACK remains the original acceptance.

Executed proof used installed TypeScript to transpile the actual current part-1 module in memory, with only external IO mocked; invoked the actual `maybeIngestMeteringValue` and `maybeCreateBillingUnderlay` with the returned-success replay shape and new 999 quantity. Output:

```json
{"reservedSeries":"ORIGINAL-SERIES","reservedQuantity":123,"retryQuantity":999,"writes":[["meter",999],["bill",999]]}
```

This is a bounded real-helper proof plus traced actual source writer, SQL and runtime; **not** an executed native SQL or full HTTP claim. No new end-to-end test was added during read-only review.

## Minimal authoritative fix

For this precise successful-retry defect, a forward-only replacement of the persistence RPC can use **existing immutable `raw_transaction` and `immutable_hash`**, avoiding a new table or fabricated historical raw-source seal:

- While holding the existing source-transaction advisory lock, before returning any successful persisted replay, load the referenced tenant-qualified series, validate its immutable stored payload/hash, and compare the entire canonical incoming transaction payload to the originally persisted payload. At minimum bind quantities/order, period/resolution/unit, point/grid identity, transaction identity and series kind; full JSONB payload equality/hash using the same original encoding is simpler and safer than an incomplete whitelist.
- On mismatch or missing/corrupt authority, raise a dedicated internal retry conflict **outside the per-series exception-to-ERR block**. Do not rewrite the original reservation, ACK, series or convert evidence conflict into a national ERR. The runtime already propagates RPC errors before ACK/legacy sink calls.
- Apply the same comparison when the insert dedupe branch reuses an existing series, not only when a transaction-result row already exists; otherwise successful cross-source dedupe still carries no content binding. Validate established tenant and message-code scope. Do not casually require original series source ID equality: current dedupe can intentionally reuse a series created under another source; first explicitly qualify that compatibility case.

This binds the actual in-memory payload used to build the RPC to the immutable accepted payload; no extra client-trusted hash is needed. The caller constructs the RPC payload from the same runtime facts that supply the sinks. A new byte-level source seal is additionally valuable for receipt identity and preventing same-ID transaction membership changes, but broader than the minimum confirmed quantity gap. **A seal only for new rows does not fix existing persisted unsealed rows.** Do not present it alone as complete remediation.

Alternative: return/load only authoritative stored series/raw-transaction content and make every downstream write consume it. This is a larger adapter change (reading times, qualities, point matching, ordering and period projection must retain semantics), and should explicitly report the incoming mismatch instead of quietly hiding changed source data.

## Backward compatibility / migration

Use a new forward migration; never edit the applied reservation migration. Public RPC shape need not change for the compare-and-reject fix. Existing rows already have raw_transaction/hash from the persistence insertion, so qualify those fields on replay. Missing authority fails internally for review; do not backfill a trusted original hash from potentially changed current `ediel_messages.raw_payload`.

Compare typed JSONB rather than ad hoc JS string order. Since an exact payload includes enriched matching fields, unchanged raw with legitimately changed matching enrichment may newly fail closed; explicitly test and document this, or define a versioned consumption projection that retains all fields which can affect sink attribution/amounts. Do not strip point/period/unit merely to keep a legacy fixture green. Existing identical replays and held-to-accepted transitions must stay working, and valid correction messages with a new identity must retain existing correction behavior.

## Required meaningful tests

1. Native disposable DB: persist accepted 123, then retry identical disposition/issues and T1 with 999; assert dedicated conflict, original series/value/hash/ACK row unchanged. Run before and after finalized ACK; use real quantities, not empty arrays. Demonstrate RED on current forward function.
2. Native: identical payload replay returns same series; JSONB key order does not cause false mismatch; changed period/unit/point/quantity order blocks; missing referenced series/hash fails closed. Include mixed accepted + held batch and ensure conflict atomically leaves all durable rows unchanged.
3. Native dedupe compatibility: new source with same current dedupe identity and identical content retains intended reuse; changed content cannot obtain old successful authority. Normal genuinely new correction identity still works.
4. Actual runtime test using real parser, persistence payload builder and sinks: first successful 123, interruption before legacy sinks, replace raw QTY with valid 999 under same ID, second processing invokes real local DB RPC. Expect no metering, billing, outbound completion or new ACK call on conflict. Retain original ACK and immutable series. Repeat with accepted sibling to prevent aggregate/fallback bypass.
5. Exercise the real inbound replacement writer with same sender/receiver/interchange and changed bytes to establish source-ID reuse explicitly. If adding source sealing instead, test insert, same-byte retry, changed-byte rejection, scoped metadata/status updates, and existing unsealed persisted rows without inventing historical receipts.

No whole-PR, E035/masterplan, hosted environment or CI approval follows from this narrow finding.
