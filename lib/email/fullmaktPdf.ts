// lib/email/fullmaktPdf.ts
//
// Dependency-free generator for a readable "fullmakt" (power of attorney) PDF
// that can be attached to an EXTERNAL grid-owner e-mail. We never attach the raw
// JSON snapshot externally; that snapshot stays internal audit. This builds a
// minimal, valid single-page PDF (Helvetica + WinAnsiEncoding so Swedish
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
  legalTextTitle?: string | null
  legalTextVersion?: string | null
  legalTextVersionId?: string | null
  acceptedAt?: string | null
  signerName?: string | null
  signerIdentityNumber?: string | null
  method?: string | null
  source?: string | null
}

const TITLE = 'Fullmakt för anläggningsuppgifter och leverantörsbyte'

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
    '',
    'Omfattning:',
    '  Fullmakten omfattar rätt att begära och ta emot anläggningsuppgifter',
    '  samt att genomföra leverantörsbyte för kundens räkning.',
    '',
    'Juridisk text:',
    `  Titel: ${val(input.legalTextTitle)}`,
    `  Version: ${val(input.legalTextVersion)}`,
    `  Versions-ID: ${val(input.legalTextVersionId)}`,
    '',
    'Godkännande:',
    `  Accepterad: ${val(input.acceptedAt)}`,
    `  Undertecknare: ${val(input.signerName)}`,
    `  Undertecknarens person-/org.nr: ${val(input.signerIdentityNumber)}`,
    `  Metod: ${val(input.method)}`,
    `  Källa: ${val(input.source)}`,
  ]

  return lines.flatMap((line) => (line ? wrap(line) : ['']))
}

// Builds a minimal valid PDF. Bytes for the content stream are written as
// latin1 (WinAnsi) so å/ä/ö render in the standard Helvetica font.
export function renderFullmaktPdf(input: FullmaktPdfInput): Buffer {
  const lines = buildFullmaktPdfLines(input).slice(0, 200)

  const content = [
    'BT',
    '/F1 11 Tf',
    '14 TL',
    '40 800 Td',
    ...lines.map((line, index) => `${index === 0 ? '' : 'T* '}(${pdfEscape(line)}) Tj`),
    'ET',
  ].join('\n')

  const contentLength = Buffer.byteLength(content, 'latin1')
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj',
    `5 0 obj << /Length ${contentLength} >> stream\n${content}\nendstream endobj`,
  ]

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
