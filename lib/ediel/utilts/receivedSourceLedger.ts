import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { discoverAndRecordReceivedSources, emptyReceivedSourceInventory, type PersistedReceivedSourceInventory } from '@/lib/ediel/utilts/durableSourceDiscovery'

const DEADLINE_MS = 2000
/** Explicit original-company/environment RPC scope. Service callers are trusted
 * backend producers; the SQL wrappers are not executable by human/anon roles.
 * No operational metering-point link, status or receipt can approve a source. */
export async function readAndRecordDurableReceivedSources(message: EdielMessageRow): Promise<PersistedReceivedSourceInventory> {
  if (message.direction !== 'inbound' || message.message_standard !== 'edifact' || message.message_family !== 'UTILTS') return emptyReceivedSourceInventory()
  return discoverAndRecordReceivedSources({ companyId: message.company_id, environment: message.environment, cutoffAt: message.message_received_at }, {
    async openSnapshot(scope) {
      const { data, error } = await supabaseService.rpc('gridex_received_source_snapshot_v1', {
        p_company_id: scope.companyId, p_environment: scope.environment, p_cutoff: scope.cutoffAt,
      }).abortSignal(AbortSignal.timeout(DEADLINE_MS))
      if (error) throw new Error('source_snapshot_unconfirmed')
      return data
    },
    async appendDiscovery(input) {
      const { data, error } = await supabaseService.rpc('gridex_record_source_discovery_v1', {
        p_company_id: input.companyId, p_environment: input.environment,
        p_snapshot_id: input.snapshotId, p_snapshot_hash: input.snapshotHash,
        p_engine_version: input.engineVersion, p_inventory_text: input.inventoryText,
      }).abortSignal(AbortSignal.timeout(DEADLINE_MS))
      if (error) throw new Error('source_discovery_unconfirmed')
      return data
    },
  })
}
