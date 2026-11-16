export type BusinessActionKind =
  | 'start_supplier_switch'
  | 'register_cancellation'
  | 'end_agreement'
  | 'request_metering_access'
  | 'request_historical_metering_access'
  | 'terminate_metering_access'
  | 'send_customer_confirmation'

export type BusinessActionDecision = {
  operation: BusinessActionKind
  edielMessageCode: 'Z03' | 'Z09' | 'Z13' | 'Z13VH' | 'Z18' | null
  sideEffects: Array<'ediel' | 'customer_email' | 'internal_task' | 'status_change' | 'unresolved_item'>
  uiStatus: string
  nextStep: string
}

export function decideBusinessAction(kind: BusinessActionKind): BusinessActionDecision {
  switch (kind) {
    case 'start_supplier_switch':
      return { operation: kind, edielMessageCode: 'Z03', sideEffects: ['ediel', 'status_change'], uiStatus: 'Leverantörsbyte startat', nextStep: 'Väntar på teknisk kvittens' }
    case 'register_cancellation':
      return { operation: kind, edielMessageCode: 'Z09', sideEffects: ['ediel', 'customer_email', 'status_change'], uiStatus: 'Ånger registrerad', nextStep: 'Systemet hanterar avslut eller annullering' }
    case 'end_agreement':
      return { operation: kind, edielMessageCode: 'Z09', sideEffects: ['ediel', 'customer_email', 'status_change'], uiStatus: 'Avslut påbörjat', nextStep: 'Väntar på bekräftelse' }
    case 'request_metering_access':
      return { operation: kind, edielMessageCode: 'Z13', sideEffects: ['ediel', 'status_change'], uiStatus: 'Väntar på kundgodkännande hos nätägaren', nextStep: 'Väntar på CONTRL och APERAK' }
    case 'request_historical_metering_access':
      return { operation: kind, edielMessageCode: 'Z13VH', sideEffects: ['ediel', 'status_change'], uiStatus: 'Historisk begäran skickad', nextStep: 'Väntar på kvittenser' }
    case 'terminate_metering_access':
      return { operation: kind, edielMessageCode: 'Z18', sideEffects: ['ediel', 'status_change'], uiStatus: 'Avslut begärt', nextStep: 'Väntar på bekräftelse från nätägare' }
    case 'send_customer_confirmation':
      return { operation: kind, edielMessageCode: null, sideEffects: ['customer_email'], uiStatus: 'Bekräftelsemail köat', nextStep: 'Väntar på e-postleverans' }
  }
}
