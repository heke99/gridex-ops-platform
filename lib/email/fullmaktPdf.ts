// lib/email/fullmaktPdf.ts
//
// Dependency-free generator for a readable "fullmakt" (power of attorney) PDF
// that can be attached to an EXTERNAL grid-owner e-mail. We never attach the raw
// JSON snapshot externally; that snapshot stays internal audit. This builds a
// minimal, valid paginated PDF (Helvetica + WinAnsiEncoding so Swedish
// characters render) from the locked POA/legal snapshot.
//
// The output is a base64 string ready for the e-mail attachment payload.

export type FullmaktPdfInput = {
  caseReference?: string | null
  powerOfAttorneyId?: string | null
  reference?: string | null
  customerName?: string | null
  customerIdentity?: string | null
  siteAddress?: string | null
  sitePostalCode?: string | null
  siteCity?: string | null
  representativeName?: string | null
  representativeOrganizationNumber?: string | null
  legalTextTitle?: string | null
  legalTextVersion?: string | null
  legalTextVersionId?: string | null
  acceptedAt?: string | null
  signerName?: string | null
  signerIdentityNumber?: string | null
  method?: string | null
  source?: string | null
  legalText?: string | null
  signedScopes?: string[]
  verificationReference?: string | null
  signerIpAddress?: string | null
  bankidVerified?: boolean
  bankidReference?: string | null
}

const TITLE = 'Fullmakt och godkännandeverifikat'

function val(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : '-'
}

function pdfEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n\t]+/g, ' ')
}

function winAnsi(value: string): string {
  const mappings: Record<number, number> = { 8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135,
    710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148,
    8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159 }
  return Array.from(value.normalize('NFC'), (character) => {
    const point = character.codePointAt(0)!
    if (point >= 32 && point <= 126 || point >= 160 && point <= 255) return character
    if (mappings[point]) return String.fromCharCode(mappings[point])
    throw new Error('Fullmaktstexten innehåller Unicode-tecken som kräver ett annat PDF-teckensnitt. Originaltexten har inte ändrats.')
  }).join('')
}

// Wrap long lines so they do not run off the page width.
function wrap(line: string, maxChars = 90): string[] {
  if (line.length <= maxChars) return [line]
  const words = line.split(' ')
  const out: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) out.push(current)
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) out.push(current)
  return out
}

export function buildFullmaktPdfLines(input: FullmaktPdfInput): string[] {
  const address = [val(input.siteAddress), [val(input.sitePostalCode), val(input.siteCity)].filter((p) => p !== '-').join(' ')]
    .filter((p) => p && p !== '-')
    .join(', ')

  const lines = [
    TITLE,
    '',
    `Ärendenummer: ${val(input.caseReference)}`,
    `Fullmakt-ID: ${val(input.powerOfAttorneyId)}`,
    `Referens: ${val(input.reference)}`,
    '',
    'Fullmaktsgivare (kund):',
    `  Namn: ${val(input.customerName)}`,
    `  Person-/organisationsnummer: ${val(input.customerIdentity)}`,
    `  Anläggningsadress: ${address || '-'}`,
    '',
    'Befullmäktigad (ombud):',
    `  ${val(input.representativeName)} företräder kunden gentemot nätägaren.`,
    `  Organisationsnummer: ${val(input.representativeOrganizationNumber)}`,
    '',
    'Omfattning:',
    ...(input.signedScopes?.length
      ? input.signedScopes.map((scope) => `  ${scope === 'facility_information_lookup' ? 'Inhämtning av anläggningsuppgifter'
        : scope === 'supplier_switch' ? 'Hantering av leverantörsbyte' : 'Ytterligare behörighet enligt godkänd fullmaktstext'}`)
      : ['  Omfattning framgår av den godkända fullmaktstexten.']),
    '',
    'Juridisk text:',
    `  Titel: ${val(input.legalTextTitle)}`,
    `  Version: ${val(input.legalTextVersion)}`,
    `  Versions-ID: ${val(input.legalTextVersionId)}`,
    ...(input.legalText ? ['', 'Godkänd fullmaktstext:', ...input.legalText.split(/\r?\n/)] : []),
    '',
    'Godkännande:',
    `  Accepterad: ${val(input.acceptedAt)}`,
    `  Undertecknare: ${val(input.signerName)}`,
    `  Undertecknarens person-/org.nr: ${val(input.signerIdentityNumber)}`,
    `  Metod: ${val(input.method)}`,
    `  Källa: ${val(input.source)}`,
    `  Verifikatsnummer: ${val(input.verificationReference)}`,
    `  Undertecknarens registrerade IP-adress: ${val(input.signerIpAddress)}`,
    `  BankID-signatur: ${input.bankidVerified ? 'verifierad' : 'inte verifierad'}`,
    ...(input.bankidVerified && input.bankidReference ? [`  BankID-referens: ${input.bankidReference}`] : []),
    '  Ett registrerat formulärgodkännande innebär inte i sig BankID-signering.',
  ]

  return lines.flatMap((line) => (line ? wrap(line) : ['']))
}

// Builds a minimal valid PDF. Bytes for the content stream are written as
// latin1 (WinAnsi) so å/ä/ö render in the standard Helvetica font.
export function renderFullmaktPdf(input: FullmaktPdfInput): Buffer {
  const lines = buildFullmaktPdfLines(input)
  const perPage = 47
  const pageCount = Math.max(1, Math.ceil(lines.length / perPage))
  if (pageCount > 100) throw new Error('Fullmaktsunderlaget är för stort för automatisk PDF-generering.')
  const pageIds = Array.from({ length: pageCount }, (_, index) => 4 + index * 2)
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >> endobj`,
    '3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj',
  ]
  for (const [index, pageId] of pageIds.entries()) {
    const header = `Verifikatsnummer: ${val(input.verificationReference)}`
    const pageLines = [...wrap(header), ...wrap(`Fullmaktsreferens: ${val(input.reference ?? input.powerOfAttorneyId)}`), `Sida ${index + 1} av ${pageCount}`, '', ...lines.slice(index * perPage, (index + 1) * perPage)]
    const content = ['BT', '/F1 11 Tf', '14 TL', '40 800 Td',
      ...pageLines.map((line, lineIndex) => `${lineIndex === 0 ? '' : 'T* '}(${winAnsi(pdfEscape(line))}) Tj`), 'ET'].join('\n')
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >> endobj`,
      `${pageId + 1} 0 obj << /Length ${Buffer.byteLength(content, 'latin1')} >> stream\n${content}\nendstream endobj`,
    )
  }

  let offset = Buffer.byteLength('%PDF-1.4\n', 'latin1')
  const xref = ['0000000000 65535 f ']
  const body =
    objects
      .map((obj) => {
        xref.push(String(offset).padStart(10, '0') + ' 00000 n ')
        offset += Buffer.byteLength(`${obj}\n`, 'latin1')
        return obj
      })
      .join('\n') + '\n'
  const xrefOffset = offset
  const pdf = `%PDF-1.4\n${body}xref\n0 ${objects.length + 1}\n${xref.join('\n')}\ntrailer << /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

export function renderFullmaktPdfBase64(input: FullmaktPdfInput): string {
  return renderFullmaktPdf(input).toString('base64')
}
