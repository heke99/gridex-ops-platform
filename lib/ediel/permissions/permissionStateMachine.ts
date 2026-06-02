export type EnergyServicePermissionState =
  | 'draft'
  | 'z13_prepared'
  | 'z13_sent'
  | 'contrl_positive'
  | 'aperak_positive'
  | 'awaiting_customer_approval_21d'
  | 'active_after_z14v_or_z14vh'
  | 'receiving_utilts_e66'
  | 'termination_requested_after_z18'
  | 'terminated_after_z15'
  | 'contrl_negative'
  | 'failed_syntax'
  | 'aperak_negative'
  | 'rejected_by_grid_owner'
  | 'z14n_a13_withdrawn'
  | 'denied_withdrawn'
  | 'z14n_a76_timeout'
  | 'denied_timeout'
  | 'z15_b79_customer_revocation'
  | 'terminated_by_customer'
  | 'z15_e37_no_grid_contract'
  | 'terminated_due_to_moveout'
  | 'z18_sent'
  | 'z15_b80_termination'
  | 'terminated_confirmed'

const TRANSITIONS: Record<EnergyServicePermissionState, EnergyServicePermissionState[]> = {
  draft: ['z13_prepared'],
  z13_prepared: ['z13_sent'],
  z13_sent: ['contrl_positive', 'contrl_negative', 'aperak_negative'],
  contrl_positive: ['aperak_positive', 'aperak_negative'],
  aperak_positive: ['awaiting_customer_approval_21d'],
  awaiting_customer_approval_21d: ['active_after_z14v_or_z14vh', 'z14n_a13_withdrawn', 'z14n_a76_timeout'],
  active_after_z14v_or_z14vh: ['receiving_utilts_e66', 'z15_b79_customer_revocation', 'z15_e37_no_grid_contract', 'z18_sent'],
  receiving_utilts_e66: ['z18_sent', 'z15_b79_customer_revocation', 'z15_e37_no_grid_contract'],
  termination_requested_after_z18: ['terminated_after_z15', 'z15_b80_termination'],
  z18_sent: ['termination_requested_after_z18', 'z15_b80_termination'],
  z15_b80_termination: ['terminated_confirmed'],
  terminated_after_z15: ['terminated_confirmed'],
  contrl_negative: ['failed_syntax'],
  aperak_negative: ['rejected_by_grid_owner'],
  z14n_a13_withdrawn: ['denied_withdrawn'],
  z14n_a76_timeout: ['denied_timeout'],
  z15_b79_customer_revocation: ['terminated_by_customer'],
  z15_e37_no_grid_contract: ['terminated_due_to_moveout'],
  failed_syntax: [],
  rejected_by_grid_owner: [],
  denied_withdrawn: [],
  denied_timeout: [],
  terminated_by_customer: [],
  terminated_due_to_moveout: [],
  terminated_confirmed: [],
}

export function canTransitionPermissionState(from: EnergyServicePermissionState, to: EnergyServicePermissionState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function transitionPermissionState(from: EnergyServicePermissionState, to: EnergyServicePermissionState): EnergyServicePermissionState {
  if (!canTransitionPermissionState(from, to)) {
    throw new Error(`Otillåten permission state transition ${from} -> ${to}.`)
  }
  return to
}
