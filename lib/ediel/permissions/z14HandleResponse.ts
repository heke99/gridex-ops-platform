import { applyPermissionEvent } from '@/lib/ediel/permissions/permissionEngine'
import type { EnergyServicePermissionState } from '@/lib/ediel/permissions/permissionStateMachine'

export function handleZ14PermissionResponse(params: {
  currentState: EnergyServicePermissionState
  responseCode: 'V' | 'VH' | 'N'
  reasonCode?: string | null
}): EnergyServicePermissionState {
  if (params.responseCode === 'N' && params.reasonCode === 'A13') {
    return applyPermissionEvent({ currentState: params.currentState, event: 'z14n_a13' })
  }
  if (params.responseCode === 'N' && params.reasonCode === 'A76') {
    return applyPermissionEvent({ currentState: params.currentState, event: 'z14n_a76' })
  }
  return applyPermissionEvent({ currentState: params.currentState, event: 'z14v_received' })
}
