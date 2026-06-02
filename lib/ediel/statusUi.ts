export const EDIEL_STATUS_LABELS: Record<string, string> = {
  queued: 'Väntar på att skickas',
  prepared: 'Förberett',
  draft: 'Utkast',
  sent: 'Skickat',
  received: 'Mottaget',
  parsed: 'Tolkat',
  validated: 'Validerat',
  acknowledged: 'Kvitterat',
  contrl_positive: 'Tekniskt mottaget',
  aperak_positive: 'Godkänt av mottagaren',
  aperak_negative: 'Avvisat - åtgärd krävs',
  contrl_negative: 'Tekniskt fel - åtgärd krävs',
  awaiting_customer_approval: 'Väntar på kundgodkännande',
  active: 'Aktivt',
  terminated: 'Avslutat',
  unresolved: 'Behöver granskas',
  failed: 'Fel - åtgärd krävs',
  manual_review: 'Behöver granskas',
}

export function edielStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Okänd status'
  return EDIEL_STATUS_LABELS[status] ?? status
}

export function missingBusinessDataMessage(missingLabels: string[]): string {
  if (missingLabels.length === 0) return ''
  return `Kan inte starta leverantörsbyte\n\nSaknas:\n${missingLabels.map((label) => `- ${label}`).join('\n')}\n\nLägg till uppgifterna och försök igen.`
}
