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
  rule_conflict: 'Regelkonflikt - teknisk granskning krävs',
  blocked_final_ack_exists: 'Slutlig kvittens finns redan',
  decision_ready: 'Beslut klart',
  ack_created: 'Kvittens skapad',
  ack_sent: 'Kvittens skickad',
  send_failed: 'Utskick misslyckades',
}

export const EDIEL_BUSINESS_STATUS_LABELS: Record<string, string> = {
  draft: 'Pågår',
  prepared: 'Pågår',
  queued: 'Pågår',
  received: 'Meddelande mottaget',
  parsed: 'Kontroll pågår',
  validated: 'Pågår',
  decision_ready: 'Kontroll pågår',
  ack_created: 'Pågår',
  sent: 'Väntar på motpart',
  ack_sent: 'Klar',
  acknowledged: 'Klar',
  aperak_positive: 'Klar',
  contrl_positive: 'Pågår',
  awaiting_customer_approval: 'Väntar på motpart',
  manual_review: 'Åtgärd krävs',
  unresolved: 'Åtgärd krävs',
  aperak_negative: 'Åtgärd krävs',
  failed: 'Tekniskt stopp',
  send_failed: 'Tekniskt stopp',
  contrl_negative: 'Tekniskt stopp',
  rule_conflict: 'Tekniskt stopp',
  blocked_final_ack_exists: 'Tekniskt stopp',
  active: 'Klar',
  terminated: 'Klar',
}

export function edielStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Okänd status'
  return EDIEL_STATUS_LABELS[status] ?? status
}

export function edielBusinessStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Kontroll pågår'
  return EDIEL_BUSINESS_STATUS_LABELS[status] ?? EDIEL_STATUS_LABELS[status] ?? status
}

export function missingBusinessDataMessage(missingLabels: string[]): string {
  if (missingLabels.length === 0) return ''
  return `Kan inte starta leverantörsbyte\n\nSaknas:\n${missingLabels.map((label) => `- ${label}`).join('\n')}\n\nLägg till uppgifterna och försök igen.`
}
