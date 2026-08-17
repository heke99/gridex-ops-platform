import type { EmailAttachment } from '@/lib/email/providers/types'

export type AgreementPdfLegalVersion = {
  type: string
  title: string
  version: string
  id: string
  body?: string | null
}

export type AgreementPdfInput = {
  companyName: string
  brandName?: string | null
  organizationNumber?: string | null
  companyAddress?: string | null
  companySupportEmail?: string | null
  companyPhone?: string | null
  companyWebsite?: string | null
  legalFooter?: string | null
  customerName: string
  customerEmail?: string | null
  customerNumber: string
  contractNumber: string
  contractName: string
  contractDescription?: string | null
  contractType?: string | null
  signedAt: string
  startsAt?: string | null
  withdrawalDeadline?: string | null
  offerReference: string
  contractPublicationVersionId?: string | null
  pricePlanVersionId?: string | null
  legalBundleVersionId?: string | null
  tenantSnapshotSha256?: string | null
  evidenceId?: string | null
  monthlyFeeSek?: number | null
  invoiceFeeSek?: number | null
  spotMarkupOrePerKwh?: number | null
  fixedPriceOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  bindingMonths?: number | null
  noticeMonths?: number | null
  autoRenewEnabled?: boolean | null
  autoRenewTermMonths?: number | null
  legalVersions: AgreementPdfLegalVersion[]
  signatureSnapshotSha256?: string | null
}

function pdfSafeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

function escapePdfString(value: string) {
  const bytes = Buffer.from(pdfSafeText(value), 'latin1')
  let output = ''
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) output += `\\${String.fromCharCode(byte)}`
    else if (byte < 0x20 || byte > 0x7e) output += `\\${byte.toString(8).padStart(3, '0')}`
    else output += String.fromCharCode(byte)
  }
  return output
}

function plainText(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function wrapLine(value: string, maxLength = 88) {
  const paragraphs = pdfSafeText(value).split(/\n/)
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = words[0]
    for (const word of words.slice(1)) {
      if (`${current} ${word}`.length <= maxLength) current += ` ${word}`
      else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines.length > 0 ? lines : ['']
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(date)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long', timeZone: 'Europe/Stockholm' }).format(date)
}

function formatAmount(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 4 }).format(value)} ${unit}`
}

function agreementLines(input: AgreementPdfInput) {
  const priceLines = [
    formatAmount(input.monthlyFeeSek, 'kr/mån'),
    formatAmount(input.invoiceFeeSek, 'kr/faktura'),
    formatAmount(input.spotMarkupOrePerKwh, 'öre/kWh spotpåslag'),
    formatAmount(input.variableFeeOrePerKwh, 'öre/kWh rörlig avgift'),
    formatAmount(input.fixedPriceOrePerKwh, 'öre/kWh fast pris'),
  ].filter((value): value is string => Boolean(value))

  return [
    'AVTALSBEKRÄFTELSE',
    '',
    `Avtalspart: ${input.companyName}`,
    ...(input.brandName && input.brandName !== input.companyName ? [`Varumärke: ${input.brandName}`] : []),
    `Organisationsnummer: ${input.organizationNumber ?? '-'}`,
    `Adress: ${input.companyAddress ?? '-'}`,
    `Kundservice: ${input.companySupportEmail ?? '-'}${input.companyPhone ? ` · ${input.companyPhone}` : ''}`,
    `Webbplats: ${input.companyWebsite ?? '-'}`,
    `Kund: ${input.customerName}`,
    `E-post: ${input.customerEmail ?? '-'}`,
    `Kundnummer: ${input.customerNumber}`,
    `Avtalsnummer: ${input.contractNumber}`,
    '',
    `Avtal: ${input.contractName}`,
    ...(input.contractDescription ? [`Beskrivning: ${plainText(input.contractDescription)}`] : []),
    `Avtalstyp: ${input.contractType ?? '-'}`,
    `Tecknat: ${formatDateTime(input.signedAt)}`,
    `Önskat startdatum: ${formatDate(input.startsAt)}`,
    `Ångerfrist till: ${formatDateTime(input.withdrawalDeadline)}`,
    `Bindningstid: ${input.bindingMonths ?? 0} månader`,
    `Uppsägningstid: ${input.noticeMonths ?? 0} månader`,
    `Automatisk förlängning: ${
      input.autoRenewEnabled
        ? `Ja${input.autoRenewTermMonths ? `, ${input.autoRenewTermMonths} månader` : ''}`
        : 'Nej'
    }`,
    '',
    'PRISVILLKOR',
    ...(priceLines.length > 0 ? priceLines : ['Pris enligt bifogat publicerat erbjudande och accepterad prisversion.']),
    '',
    'JURIDISKA DOKUMENT SOM ACCEPTERADES',
    ...input.legalVersions.flatMap((version) => [
      '',
      `${version.title} - version ${version.version}`,
      `Versions-ID: ${version.id}`,
      plainText(version.body) || 'Dokumenttext saknas i PDF-snapshotet. Kontrollera originalsnapshotet i OPS.',
    ]),
    '',
    'BEVISUPPGIFTER',
    `Offer reference: ${input.offerReference}`,
    `Publiceringsversion: ${input.contractPublicationVersionId ?? '-'}`,
    `Prisversion: ${input.pricePlanVersionId ?? '-'}`,
    `Juridikversion: ${input.legalBundleVersionId ?? '-'}`,
    `Bevis-ID: ${input.evidenceId ?? input.contractNumber}`,
    `Tenantsnapshot SHA-256: ${input.tenantSnapshotSha256 ?? '-'}`,
    `Signatursnapshot SHA-256: ${input.signatureSnapshotSha256 ?? '-'}`,
    '',
    input.legalFooter ?? 'Detta dokument återger exakt den publicerings-, pris-, juridik- och tenantversion som var bunden till kundens serverregistrerade accept. Gridex OPS är teknisk plattform och är inte avtalspart om inte annat uttryckligen anges.',
  ].flatMap((line) => wrapLine(line))
}

function contentStream(lines: string[]) {
  const commands = ['BT', '/F1 10 Tf', '48 794 Td', '13 TL']
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (index > 0) commands.push('T*')
    commands.push(`(${escapePdfString(line)}) Tj`)
  }
  commands.push('ET')
  return Buffer.from(commands.join('\n'), 'latin1')
}

export function buildAgreementPdfBuffer(input: AgreementPdfInput): Buffer {
  const allLines = agreementLines(input)
  const pageSize = 54
  const pages: string[][] = []
  for (let index = 0; index < allLines.length; index += pageSize) pages.push(allLines.slice(index, index + pageSize))
  if (pages.length === 0) pages.push(['AVTALSBEKRÄFTELSE'])

  const objects: Buffer[] = []
  const addObject = (body: Buffer | string) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'))
    return objects.length
  }

  const catalogId = addObject('')
  const pagesId = addObject('')
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const pageIds: number[] = []

  for (const lines of pages) {
    const stream = contentStream(lines)
    const contentId = addObject(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]))
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1')
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1')

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets = [0]
  let offset = chunks[0].length
  objects.forEach((body, index) => {
    offsets.push(offset)
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ])
    chunks.push(object)
    offset += object.length
  })

  const xrefOffset = offset
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('')
  chunks.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(chunks)
}

export function buildAgreementPdfAttachment(input: AgreementPdfInput): EmailAttachment {
  const safeContractNumber = input.contractNumber.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'avtal'
  return {
    filename: `avtalsbekraftelse-${safeContractNumber}.pdf`,
    content: buildAgreementPdfBuffer(input).toString('base64'),
    contentType: 'application/pdf',
  }
}
