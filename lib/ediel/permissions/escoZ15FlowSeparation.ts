import { handleZ15PermissionTermination } from '@/lib/ediel/permissions/z15HandleTermination'
import type { EnergyServicePermissionState } from '@/lib/ediel/permissions/permissionStateMachine'

/**
 * ESCO Z15 V/VH separation (23-DGI-PRODAT, BGM Z15, field 223 S17/S18).
 *
 * Pure decision over an already tenant-scoped flow register. Z15 with S17 ends
 * exactly the continuous (V) reporting/permission flow it correlates to; Z15
 * with S18 completes the bounded history (VH) job and marks its coverage for
 * review. Neither ends the other mode's flow, another tenant's flow or the
 * separate DDQ delivery, and neither originates a new Z13. A rejected input
 * returns the register unchanged (no partial mutation).
 *
 * This module is not wired to persistence: the authoritative SQL source writer
 * (ediel_apply_permission_source_v1) remains the persisted path.
 */
export type EscoFlowMode = 'V' | 'VH'

export type EscoPermissionFlow = {
  flowId: string
  companyId: string
  permissionId: string
  objectId: string
  mode: EscoFlowMode
  state: EnergyServicePermissionState
  historyJob: { status: 'open' | 'completed'; coverageReview: 'not_required' | 'pending' } | null
}

export type EscoDdqDelivery = { companyId: string; objectId: string; status: 'active' | 'ended' }

export type EscoRegister = { flows: readonly EscoPermissionFlow[]; ddqDeliveries: readonly EscoDdqDelivery[] }

export type EscoZ15Input = {
  receivingCompanyId: string
  direction: 'inbound' | 'outbound'
  process: string
  bgm: string
  field223: string
  senderRole: string
  receiverRole: string
  /** DTM+164 effective end. */
  datum164: string | null
  /** RFF Z09 permission id. */
  idZ09: string | null
  /** Status/reason (B77/B78/B79/B80/E37). */
  reasonCode: string | null
  objectId: string | null
}

export type EscoZ15Result =
  | { executed: true; register: EscoRegister; endedFlowId: string; mode: EscoFlowMode
    acknowledgements: readonly ['CONTRL', 'APERAK']; automaticZ13: false }
  | { executed: false; register: EscoRegister; reason: string; acknowledgements: readonly []; automaticZ13: false }

const MODE_BY_223: Record<string, EscoFlowMode> = { S17: 'V', S18: 'VH' }

function reject(register: EscoRegister, reason: string): EscoZ15Result {
  return { executed: false, register, reason, acknowledgements: [], automaticZ13: false }
}

export function applyEscoZ15Termination(register: EscoRegister, input: EscoZ15Input): EscoZ15Result {
  if (input.direction !== 'inbound') return reject(register, 'z15_wrong_direction')
  if (input.process !== '23-DGI-PRODAT' || input.bgm !== 'Z15') return reject(register, 'z15_wrong_message')
  if (input.senderRole !== 'DSO' || input.receiverRole !== 'ESCO') return reject(register, 'z15_wrong_role')
  const mode = MODE_BY_223[input.field223]
  if (!mode) return reject(register, 'z15_field223_unqualified')
  if (!input.datum164 || !Number.isFinite(Date.parse(input.datum164))) return reject(register, 'z15_required_field_missing:datum164')
  if (!input.idZ09) return reject(register, 'z15_required_field_missing:idZ09')
  if (!input.reasonCode) return reject(register, 'z15_required_field_missing:reason')
  if (!input.objectId) return reject(register, 'z15_required_field_missing:object')
  if (!input.receivingCompanyId) return reject(register, 'z15_tenant_unassigned')

  const candidates = register.flows.filter(f => f.permissionId === input.idZ09 && f.objectId === input.objectId)
  const own = candidates.filter(f => f.companyId === input.receivingCompanyId)
  if (!own.length) return reject(register, candidates.length ? 'z15_other_tenant_flow' : 'z15_correlation_unmatched')
  const target = own.filter(f => f.mode === mode)
  if (target.length !== 1) return reject(register, target.length ? 'z15_correlation_ambiguous' : 'z15_mode_mismatch')
  const flow = target[0]
  if (mode === 'VH' && flow.historyJob?.status !== 'open') return reject(register, 'z15vh_history_job_not_open')

  let state: EnergyServicePermissionState
  try {
    state = handleZ15PermissionTermination({ currentState: flow.state, reasonCode: input.reasonCode })
  } catch (error) {
    return reject(register, error instanceof Error ? error.message : 'z15_transition_rejected')
  }

  const ended: EscoPermissionFlow = {
    ...flow,
    state,
    historyJob: mode === 'VH' ? { status: 'completed', coverageReview: 'pending' } : flow.historyJob,
  }
  return {
    executed: true,
    register: { flows: register.flows.map(f => (f === flow ? ended : f)), ddqDeliveries: register.ddqDeliveries },
    endedFlowId: flow.flowId,
    mode,
    acknowledgements: ['CONTRL', 'APERAK'],
    automaticZ13: false,
  }
}
