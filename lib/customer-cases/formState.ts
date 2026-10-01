export type SupportFormState = { ok: true; revision: number; caseReference?: string; message: string } |
  { ok: false; code: string; message: string; conflict?: boolean }

export function supportFormError(error: unknown): SupportFormState {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'support_legacy_idempotency_requires_review') {
    return { ok: false, code, conflict: true, message: 'Ett äldre försök med samma nyckel behöver kontrolleras. Ditt utkast är kvar. Kontrollera det befintliga ärendet och dess sparade resultat innan ett nytt ärende skapas.' }
  }
  if (['support_revision_conflict', 'support_idempotency_conflict'].includes(code)) {
    return { ok: false, code, conflict: true, message: 'Ärendet har ändrats. Ditt utkast är kvar. Läs om den aktuella versionen och jämför innan du försöker igen.' }
  }
  if (['support_status_transition_forbidden', 'support_case_closed'].includes(code)) {
    return { ok: false, code, message: 'Ärendet kan inte ändras i detta tillstånd. Läs om dess aktuella status. Ditt utkast är kvar.' }
  }
  if (code === 'invalid_support_command') return { ok: false, code, message: 'Kontrollera rubrik, text och aktuellt ärende. Ditt utkast är kvar.' }
  if (code === 'invalid_support_attachment') return { ok: false, code, message: 'Välj en PDF, PNG, JPEG eller textfil med ett giltigt filnamn. Filen får inte vara tom. Ditt utkast är kvar.' }
  if (code === 'support_attachment_too_large') return { ok: false, code, message: 'Bilagan får vara högst 5 MiB. Välj en mindre fil. Ditt utkast är kvar.' }
  if (code === 'support_attachment_unavailable') return { ok: false, code, message: 'Bilagan kunde inte bekräftas. Filen och försöksnyckeln är kvar. Försök igen med samma fil. Mottagna filer ligger i privat karantän.' }
  if (code === 'support_publication_required') return { ok: false, code, message: 'Publicera en kundsynlig ärendeversion innan du skriver till kunden. Ditt utkast är kvar.' }
  return { ok: false, code: code || 'support_not_confirmed', message: 'Åtgärden kunde inte bekräftas. Ditt utkast och försöksnyckel är kvar. Kontrollera aktuell behörighet och sparat resultat innan ett nytt försök.' }
}
