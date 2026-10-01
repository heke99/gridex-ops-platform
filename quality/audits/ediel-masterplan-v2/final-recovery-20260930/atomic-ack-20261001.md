# Atomic prescribed outbound ACK packet

Owned branch: `codex/ediel-ack-replay-20261001`; forward migration created by Supabase CLI 2.118.0 as `20260930231958_ediel_atomic_ack_owner_persistence.sql`. Original publisher branches and hosted DB were untouched.

The canonical ACK gateway now uses `persistAtomicOutboundAck` and service-only `ediel_create_outbound_ack_atomic_v1`. The port whitelists final wire/display/transport metadata; SQL derives source, company/environment, current requesting actor, captured legal role/profile/transport endpoint, private pack evidence, witness, sequence, physical outcome, source operation and inherited tenant-owned business resources. Current grants are locked before source reads. The candidate universe takes SHARE ROW EXCLUSIVE before read-only SHARE, so same/opposite/different source keys cannot deadlock through competing message-table lock upgrades. Fresh private witness mint, actual INSERT triggers/consumption/namespace/source-generated guide, business references, created audit and immutable creation receipt execute in one native transaction.

Established replay uses the actual consumed own response with current grant/membership/local captured legal role/profile/transport endpoint. A forward common-header proof checks the private immutable route receipt and original generated guide without selecting the current route/profile. Fresh preparation and SEND still use the existing current-route checks. CONTRL now passes the authenticated SMTP host/port receipt to fresh SQL; public row/owner/pack/resource selectors do not enter the JSON draft.

| Check | Result | Limit |
| --- | --- | --- |
| Focused unit DTO, gateway, legal parties, protected replay, technical route | 75 / 75 pass | Mechanical port mocks; not native source authority |
| Bounded actual SQL common-header runner, protected replay and atomic owner | 49 checks pass: 27 inherited + 11 replay + 11 atomic | Declared synthetic schema; only selected genuine functions are exercised |
| Independent RED split-transaction baseline | Genuine witness and public message survive a failed created-audit INSERT | Reproduces old atomicity violation; baseline is intentionally unsuccessful against the required no-effect property |
| GREEN native functions in bounded SQL | Actual fresh common witness, real generated guide, immutable wire namespace, private consumption, creation audit/receipt; failed last audit leaves counts unchanged | Does not prove ordinary national/ESCO source pipelines or PostgreSQL concurrency |
| Current grant, membership, local namespace revocation and opposite-outcome replay | Hold with unchanged message/witness/namespace/audit/receipt/transport counts | Bounded declared schema |
| Current route/profile changed after creation | Same frozen own response, no new effect and no route selection | Bounded actual immutable common proof |
| Ordinary native suite fixture | Existing native ACK file now has actual HTTP atomic fresh common, last-event rollback, same/opposite concurrent transactions, and a transaction observed waiting behind genuine pending grant revocation | Written, not executed locally: no local native Supabase/Docker surface; requires exact frozen candidate CI |
| Script TypeScript | Own DTO/ACK native code corrected; known stale branch dependency errors remain outside packet | Not a full clean integration/build claim |

ESCO positive derivation/current revocation is provided by the separately owned later `capture_positive_service_scope_v1` / `require_positive_service_scope_v1` forward migration. A prescribed negative response does not require positive business-data approval. Actual positive wire and frozen original actor role select the private positive-scope path; parsed service flags are not authority.

Still requiring exact frozen native evidence: ordinary national ACK witness/refs last-write failure, independent per-sequence native races, ESCO actual accepted-storage/assignment/Z14/grant/evidence receipt positive and revocation chain, all-family authentic replay, generated artifacts, browser, build, CI and original requirement ledger. The packet is an implementation, not masterplan acceptance; its focused green checks do not close F0–F7 or all 352 requirements.
