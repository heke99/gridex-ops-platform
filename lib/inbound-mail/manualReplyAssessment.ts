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

function inspectAuthoredManualReply(text: string): { text: string; requiresReview: boolean } {
  // Callers reject oversized authored replies. Never silently remove a later
  // condition while keeping the apparently unconditional date before it.
  const lines = text.replace(/\r/g, '').split('\n')
  const authored: string[] = []
  let history = false
  let quoted = false
  let requiresReview = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const historicalHeader = /^\s*-{2,}\s*(?:original|ursprungligt|vidarebefordrat|forwarded)/i.test(line)
      || /^\s*(?:On .+wrote:|Den .+skrev.*:)/i.test(line)
      || (/^\s*(?:Från|From):/i.test(line) && /^(?:.*\n){0,5}.*(?:Skickat|Sent|Till|To|Ämne|Subject):/im.test(lines.slice(index + 1, index + 7).join('\n')))
    if (historicalHeader) { history = true; quoted = false; continue }
    if (/^\s*>/.test(line)) { quoted = true; continue }
    // A later unquoted line may be an inline answer or a wrapped old quote.
    // Preserve it before a history boundary and conservatively flag ambiguity.
    if (quoted && line.trim()) requiresReview = true
    if (!history) authored.push(line)
  }
  return { text: authored.join('\n').trim(), requiresReview }
}

export function authoredManualReply(text: string): string {
  return inspectAuthoredManualReply(text).text
}

export function authoredManualReplyRequiresReview(text: string): boolean {
  return inspectAuthoredManualReply(text).requiresReview
}

/** Remove quoted HTML regions without dropping an authored suffix. This is a
 * source selector, not an HTML renderer; malformed or interleaved structure is
 * explicitly held for review while the original HTML remains on the message. */
export function stripQuotedManualReplyHtml(html: string): { html: string; requiresReview: boolean } {
  const output: string[] = []
  let cursor = 0
  let quoteDepth = 0
  let seenQuote = false
  let requiresReview = false
  const appendText = (value: string) => {
    if (quoteDepth) return
    output.push(value)
    if (seenQuote && value.replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').trim()) requiresReview = true
  }
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor)
    if (start < 0) { appendText(html.slice(cursor)); break }
    appendText(html.slice(cursor, start))
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4)
      if (end < 0) { requiresReview = true; break }
      cursor = end + 3
      continue
    }
    const tagStart = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(html.slice(start))
    if (!tagStart && !/^<[!?]/.test(html.slice(start, start + 2))) {
      appendText('<')
      cursor = start + 1
      continue
    }
    let quote: string | null = null
    let end = start + 1
    for (; end < html.length; end += 1) {
      const character = html[end]
      if (quote) { if (character === quote) quote = null }
      else if (character === '"' || character === "'") quote = character
      else if (character === '>') break
    }
    if (end >= html.length) { requiresReview = true; break }
    const tag = html.slice(start, end + 1)
    const name = tagStart?.[2].toLowerCase()
    const closing = tagStart?.[1] === '/'
    if (name === 'blockquote') {
      seenQuote = true
      if (closing) {
        if (quoteDepth === 0) requiresReview = true
        else quoteDepth -= 1
      } else {
        quoteDepth += 1
        if (/\/\s*>$/.test(tag) || quoteDepth > 64) requiresReview = true
      }
      if (quoteDepth === 0) output.push('\n')
    } else if (!closing && name && ['script', 'style', 'template'].includes(name)) {
      // Raw-text elements may contain literal quote tags; they are not visible
      // authored clauses and must not change the HTML quote nesting.
      const close = new RegExp(`</${name}\\s*>`, 'ig')
      close.lastIndex = end + 1
      const match = close.exec(html)
      if (!match) { requiresReview = true; break }
      cursor = match.index + match[0].length
      continue
    } else if (quoteDepth === 0) output.push(tag)
    cursor = end + 1
  }
  if (quoteDepth !== 0) requiresReview = true
  return { html: output.join(''), requiresReview }
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
