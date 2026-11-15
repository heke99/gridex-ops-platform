/** Display only: delivery state never grants permission to send. */
export function customerEmailStatus(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    queued: 'Väntar på utskick',
    sent: 'Skickad',
    delivered: 'Levererad',
    bounced: 'Kunde inte levereras',
    complained: 'Anmält av mottagaren',
    failed: 'Misslyckades',
    cancelled: 'Avbruten',
  }
  return labels[status ?? ''] ?? 'Status behöver granskas'
}
