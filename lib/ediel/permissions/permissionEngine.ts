import {
  transitionPermissionState,
  type EnergyServicePermissionState,
} from '@/lib/ediel/permissions/permissionStateMachine'

export function applyPermissionEvent(params: {
  currentState: EnergyServicePermissionState
  event:
    | 'z13_prepared'
    | 'z13_sent'
    | 'contrl_positive'
    | 'contrl_negative'
    | 'aperak_positive'
    | 'aperak_negative'
    | 'z14v_received'
    | 'z14n_a13'
    | 'z14n_a76'
    | 'utilts_e66_received'
    | 'z18_sent'
    | 'z15_b80'
    | 'z15_b79'
    | 'z15_e37'
}): EnergyServicePermissionState {
  const targetByEvent: Record<typeof params.event, EnergyServicePermissionState> = {
    z13_prepared: 'z13_prepared',
    z13_sent: 'z13_sent',
    contrl_positive: 'contrl_positive',
    contrl_negative: 'contrl_negative',
    aperak_positive: 'aperak_positive',
    aperak_negative: 'aperak_negative',
    z14v_received: 'active_after_z14v_or_z14vh',
    z14n_a13: 'z14n_a13_withdrawn',
    z14n_a76: 'z14n_a76_timeout',
    utilts_e66_received: 'receiving_utilts_e66',
    z18_sent: 'z18_sent',
    z15_b80: 'z15_b80_termination',
    z15_b79: 'z15_b79_customer_revocation',
    z15_e37: 'z15_e37_no_grid_contract',
  }

  return transitionPermissionState(params.currentState, targetByEvent[params.event])
}
