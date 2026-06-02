import { applyPermissionEvent } from '@/lib/ediel/permissions/permissionEngine'
import type { EnergyServicePermissionState } from '@/lib/ediel/permissions/permissionStateMachine'

export function handleZ15PermissionTermination(params: {
  currentState: EnergyServicePermissionState
  reasonCode: 'B80' | 'B79' | 'E37' | string
}): EnergyServicePermissionState {
  if (params.reasonCode === 'B79') {
    return applyPermissionEvent({ currentState: params.currentState, event: 'z15_b79' })
  }
  if (params.reasonCode === 'E37') {
    return applyPermissionEvent({ currentState: params.currentState, event: 'z15_e37' })
  }
  return applyPermissionEvent({ currentState: params.currentState, event: 'z15_b80' })
}
