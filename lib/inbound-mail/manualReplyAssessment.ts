// Mail is untrusted data. This assessment can request review; it cannot grant
// authority, approve a signature, change contacts or release a market process.
export type ManualReplyAssessment = {
  outcome: 'rejected' | 'completion_requested'
  intent: 'power_of_attorney_rejected' | 'power_of_attorney_completion_requested'
  reason_codes: string[]
  evidence: Array<{ code: string; excerpt: string }>
  suggested_recipients: string[]
  message: string
}

export function authoredManualReply(text: string): string {
  const lines = text.replace(/\r/g, '').slice(0, 100_000).split('\n')
  const authored: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*>/.test(line)
      || /^\s*-{2,}\s*(?:original|ursprungligt|vidarebefordrat|forwarded)/i.test(line)
      || /^\s*(?:On .+wrote:|Den .+skrev.*:)/i.test(line)
      || (/^\s*(?:Från|From):/i.test(line) && /^(?:.*\n){0,5}.*(?:Skickat|Sent|Till|To|Ämne|Subject):/im.test(lines.slice(index + 1, index + 7).join('\n')))) break
    authored.push(line)
  }
  return authored.join('\n').trim()
}

export function assessManualReply(text: string, subject?: string | null): ManualReplyAssessment | null {
  const body = authoredManualReply(text)
  const explicitAcceptance = /fullmakt\w*[^\n.!?]*(?:är godkänd|är accepterad)|(?:vi )?godkänner (?:er |din )?fullmakt/i.test(body)
  const authored = [!explicitAcceptance ? subject : null, body].filter(Boolean).join('\n')
  if (!/fullmakt/i.test(authored)) return null
  const evidence: ManualReplyAssessment['evidence'] = []
  const add = (code: string, pattern: RegExp) => {
    const match = pattern.exec(authored)
    if (!match) return
    const excerpt = match[0].trim().slice(0, 500)
    if (code === 'poa_bankid_signature_missing' && /bank\s*id[^\n.!?]{0,30}(?:krävs|behövs)\s+inte|(?:behöver|kräver)\s+inte[^\n.!?]{0,40}bank\s*id/i.test(excerpt)) return
    if (code === 'tenant_organization_number_missing' && /behöver\s+inte\s+kompletteras[^\n.!?]{0,80}organisationsnummer|organisationsnummer[^\n.!?]{0,30}(?:krävs|behövs)\s+inte/i.test(excerpt)) return
    evidence.push({ code, excerpt })
  }
  add('poa_bankid_signature_missing', /[^\n.!?]*(?:(?:sakna[rs]|ej|inte)[^\n.!?]*bank\s*id|bank\s*id[^\n.!?]*(?:sakna[rs]|behöv|kräv))[^\n.!?]*/i)
  add('tenant_organization_number_missing', /[^\n.!?]*(?:(?:sakna[rs]|inte|ej)[^\n.!?]*organisationsnummer|organisationsnummer[^\n.!?]*(?:sakna[rs]|inte|ej))[^\n.!?]*/i)
  add('poa_verification_missing', /[^\n.!?]*(?:(?:sakna[rs]|inte|ej)[^\n.!?]*(?:verifikationsnummer|verikafikationsnummer|verifikat|transaktionsnummer)|(?:verifikationsnummer|verikafikationsnummer|verifikat|transaktionsnummer)[^\n.!?]*(?:sakna[rs]|inte|ej))[^\n.!?]*/i)
  add('recipient_correction_requested', /[^\n.!?]*(?:inte till (?:vår |er )?leverantörsbytesgrupp|(?:fel|rätt) (?:adress|mottagare)|till (?:ovan|denna|följande) adress[^\n.!?]*(?:sänd|skick))[^\n.!?]*/i)
  const rejected = /(?:nekar|avvisar|underkänner)\s+(?:vi\s+)?(?:din|er|denna|bifogad|fullmakten|fullmakt)|fullmakt[^\n.!?]*(?:nekad|avvisad|underkänd|inte godkänd)|(?:kan (?:vi )?inte|inte kan) godkänna/i.test(authored)
  if (!rejected && evidence.length === 0 && !/(?:ni behöver|återkom|inkom|komplettera)[^\n.!?]*(?:korrekt|ny|komplett|fullmakt)/i.test(authored)) return null
  if (evidence.length === 0) evidence.push({ code: rejected ? 'poa_rejected' : 'poa_completion_required', excerpt: authored.slice(0, 500) })
  const reasonMessages: Record<string, string> = {
    poa_bankid_signature_missing: 'Kundens BankID-signatur eller signeringsbevis saknas.',
    tenant_organization_number_missing: 'Ombudets organisationsnummer saknas.',
    poa_verification_missing: 'Fullmaktens verifikationsuppgifter saknas.',
    recipient_correction_requested: 'Motparten begär en annan mottagaradress; verifiera kontaktregistret.',
  }
  return {
    outcome: rejected ? 'rejected' : 'completion_requested',
    intent: rejected ? 'power_of_attorney_rejected' : 'power_of_attorney_completion_requested',
    reason_codes: evidence.map((entry) => entry.code), evidence,
    suggested_recipients: evidence.some((entry) => entry.code === 'recipient_correction_requested')
      ? Array.from(new Set((authored.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((value) => value.toLowerCase()))).slice(0, 10) : [],
    message: (rejected
      ? 'Motparten har nekat fullmakten. Kontrollera signeringsbevis och komplettera fullmakten före nytt utskick.'
      : 'Motparten begär komplettering. Kontrollera ombudets uppgifter, fullmaktsverifikat och verifierad mottagare före nytt utskick.')
      + ' ' + evidence.map((entry) => reasonMessages[entry.code] ?? '').filter(Boolean).join(' '),
  }
}
