// EDIEL02: direktanrop av gridex_consume_utilts_metering_v1 med lagrat kontrakt (som SC046-testet gör i sc046DirectMeter).
// Ursprung (anropsform): 1c0c088c:scripts/ediel-utilts-err-gateway-native.test.ts rad 539-544 sc046DirectMeter().
import { adminClient, lit, sql } from './seed.mjs'

export async function consumeMeteringDirect(companyId: string, actorId: string, sourceMessageId: string, transactionId: string, override?: Record<string, unknown>) {
  const raw = sql(`SELECT contract FROM gridex_utilts_binding.contracts WHERE company_id=${lit(companyId)} AND source_message_id=${lit(sourceMessageId)} AND transaction_id=${lit(transactionId)}`)
  if (!raw) return { data: null, error: { message: 'e02_harness_contract_not_found', code: 'E02' } }
  const contract = JSON.parse(raw)
  return adminClient().rpc('gridex_consume_utilts_metering_v1', {
    p_company_id: companyId, p_source_message_id: sourceMessageId, p_transaction_id: transactionId, p_observation_ordinal: 0, p_actor_id: actorId, p_expected_contract: override ?? contract,
  })
}
