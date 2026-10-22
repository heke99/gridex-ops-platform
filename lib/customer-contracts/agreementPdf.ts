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
  /** Exact customer-facing components from the accepted frozen price snapshot. */
  priceLines?: string[]
  bindingMonths?: number | null
  noticeMonths?: number | null
  legalVersions: AgreementPdfLegalVersion[]
  signatureSnapshotSha256?: string | null
  /**
   * FINDINGS F51: the signed snapshot's customer masterdata section. When present the
   * customer sees exactly the identity and registered address that are sent to the grid
   * owner. Absent for contracts signed without it, whose PDF stays byte-identical.
   * Callers pass the snapshot value as stored; only a section with exactly the rule's
   * shape is rendered (contractCustomerMasterdataSection).
   */
  customerMasterdata?: ContractCustomerMasterdataSection | unknown
}

/**
 * The hash-bound customer masterdata section of a signature snapshot
 * (`customer_masterdata`, built by gridex_customer_masterdata.contract_section_v1 exactly
 * like the Ediel masterdata rule basis_v1 builds it from the registered address).
 */
export type ContractCustomerMasterdataSection = {
  schema: 'gridex_contract_customer_masterdata_v1'
  customerId: string
  registeredAddressId: string
  source: 'website_declaration' | 'staff_entry'
  declaredAt: string | null
  customerIdentity: { id: string; qualifier: 'SE1' | 'SE2'; agency: '260' }
  endUserMasterdata: { nameParts: string[]; streetParts: string[]; postalCode: string; city: string; country: string }
}

const MASTERDATA_KEYS = ['nameParts', 'streetParts', 'postalCode', 'city', 'country']
const textPart = (value: unknown, min: number, max: number) =>
  typeof value === 'string' && Array.from(value).length >= min && Array.from(value).length <= max && !/[\x00-\x1f\x7f]/.test(value)

/** The section when it has exactly the rule's shape; otherwise null (never a partial section). */
export function contractCustomerMasterdataSection(value: unknown): ContractCustomerMasterdataSection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const section = value as Record<string, unknown>
  const identity = section.customerIdentity as Record<string, unknown> | null | undefined
  const masterdata = section.endUserMasterdata as Record<string, unknown> | null | undefined
  if (section.schema !== 'gridex_contract_customer_masterdata_v1' || typeof section.customerId !== 'string' || typeof section.registeredAddressId !== 'string'
    || (section.source !== 'website_declaration' && section.source !== 'staff_entry') || (section.declaredAt !== null && typeof section.declaredAt !== 'string')) return null
  if (!identity || typeof identity !== 'object' || (identity.qualifier !== 'SE1' && identity.qualifier !== 'SE2') || identity.agency !== '260'
    || !textPart(identity.id, 1, 35) || identity.id !== String(identity.id).trim()) return null
  if (!masterdata || typeof masterdata !== 'object' || Object.keys(masterdata).some((key) => !MASTERDATA_KEYS.includes(key))) return null
  const { nameParts, streetParts, postalCode, city, country } = masterdata
  if (!Array.isArray(nameParts) || nameParts.length < 1 || nameParts.length > 2 || !nameParts.every((part) => textPart(part, 1, 35))) return null
  if (!Array.isArray(streetParts) || streetParts.length < 1 || streetParts.length > 3 || !streetParts.every((part) => textPart(part, 0, 35))
    || !streetParts.some((part) => part !== '' && part !== '.')) return null
  if (!textPart(postalCode, 1, 9) || !textPart(city, 1, 35) || typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return null
  return section as ContractCustomerMasterdataSection
}

/**
 * The customer-details lines of the agreement PDF. The derivation of the Ediel masterdata
 * declaration (gridex_customer_masterdata.contract_pdf_lines_v1) requires each of these exact
 * lines in the signed bytes, so both lists must stay identical.
 */
export function customerMasterdataPdfLines(section: ContractCustomerMasterdataSection): string[] {
  const organization = section.customerIdentity.qualifier === 'SE1'
  const masterdata = section.endUserMasterdata
  return [
    `Namn: ${masterdata.nameParts.join('')}`,
    `${organization ? 'Organisationsnummer' : 'Personnummer'}: ${section.customerIdentity.id}`,
    `${organization ? 'Registrerad adress' : 'Folkbokföringsadress'}: ${masterdata.streetParts[0] ?? ''}`,
    ...masterdata.streetParts.slice(1).map((part, index) => `Adressrad ${index + 2}: ${part}`),
    `Postnummer och ort: ${masterdata.postalCode} ${masterdata.city}`,
    `Land: ${masterdata.country}`,
  ]
}

export type PdfLine = {
  text: string
  style?: 'title' | 'heading' | 'body' | 'small'
}

const CUSTOMER_CONTRACT_TYPE_LABELS: Record<string, string> = {
  fixed: 'Fast pris',
  fixed_price: 'Fast pris',
  variable_monthly: 'Månadsrörligt',
  variable_hourly: 'Timpris',
  spot_hourly: 'Timpris',
  variable_quarterly: 'Kvartspris',
  variable_quarter_hour: 'Kvartspris',
  spot_quarter_hour: 'Kvartspris',
  portfolio: 'Portföljförvaltat',
  portfolio_managed: 'Portföljförvaltat',
  mixed: 'Mixavtal',
  variable_spot: 'Rörligt elpris',
}

export function customerContractTypeLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  return CUSTOMER_CONTRACT_TYPE_LABELS[normalized] ?? null
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

function wrapLine(value: string, maxLength = 82) {
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

function monthLabel(value: number | null | undefined) {
  const months = value ?? 0
  return `${months} ${months === 1 ? 'månad' : 'månader'}`
}

function cleanAddress(value: string | null | undefined) {
  const parts = String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const deduped = parts.filter((part, index) => index === 0 || part.toLocaleLowerCase('sv-SE') !== parts[index - 1]?.toLocaleLowerCase('sv-SE'))
  return deduped.join(', ')
}

function addWrapped(lines: PdfLine[], text: string, style: PdfLine['style'] = 'body', maxLength = 82) {
  for (const wrapped of wrapLine(text, maxLength)) lines.push({ text: wrapped, style })
}

function agreementLines(input: AgreementPdfInput): PdfLine[] {
  const lines: PdfLine[] = []
  const brand = input.brandName?.trim() || input.companyName
  const address = cleanAddress(input.companyAddress) || '-'
  const contractTypeLabel = customerContractTypeLabel(input.contractType)
  const priceLines = input.priceLines ?? [
    formatAmount(input.monthlyFeeSek, 'kr/mån'),
    formatAmount(input.invoiceFeeSek, 'kr/faktura'),
    formatAmount(input.spotMarkupOrePerKwh, 'öre/kWh spotpåslag'),
    formatAmount(input.variableFeeOrePerKwh, 'öre/kWh rörlig avgift'),
    formatAmount(input.fixedPriceOrePerKwh, 'öre/kWh fast pris'),
  ].filter((value): value is string => Boolean(value))

  lines.push({ text: brand.toUpperCase(), style: 'small' })
  lines.push({ text: 'AVTALSBEKRÄFTELSE', style: 'title' })
  lines.push({ text: `Avtalsnummer ${input.contractNumber}`, style: 'small' })
  lines.push({ text: '' })
  addWrapped(lines, `Hej ${input.customerName},`, 'body')
  addWrapped(lines, `Tack för att du har valt ${brand}. Här är en sammanfattning av det elavtal du tecknade ${formatDateTime(input.signedAt)}. Spara denna bekräftelse.`, 'body')

  const customerMasterdata = contractCustomerMasterdataSection(input.customerMasterdata)
  if (customerMasterdata) {
    lines.push({ text: '' })
    lines.push({ text: 'KUNDUPPGIFTER', style: 'heading' })
    // Each line is written whole (never wrapped) so the signed bytes carry it exactly.
    for (const text of customerMasterdataPdfLines(customerMasterdata)) lines.push({ text })
    addWrapped(lines, 'Dessa uppgifter lämnas till din nätägare när leverantörsbytet anmäls. Kontakta oss om de inte stämmer.', 'small', 88)
  }

  lines.push({ text: '' })
  lines.push({ text: 'DITT AVTAL', style: 'heading' })
  addWrapped(lines, `${input.contractName}${input.contractDescription ? ` - ${plainText(input.contractDescription)}` : ''}`)
  lines.push({ text: `Kundnummer: ${input.customerNumber}` })
  lines.push({ text: `Avtalsnummer: ${input.contractNumber}` })
  if (contractTypeLabel) lines.push({ text: `Avtalstyp: ${contractTypeLabel}` })
  lines.push({ text: `Önskat startdatum: ${formatDate(input.startsAt)}` })
  lines.push({ text: `Bindningstid: ${monthLabel(input.bindingMonths)}` })
  lines.push({ text: `Uppsägningstid: ${monthLabel(input.noticeMonths)}` })

  lines.push({ text: '' })
  lines.push({ text: 'PRIS', style: 'heading' })
  if (priceLines.length > 0) {
    for (const price of priceLines) addWrapped(lines, price)
  } else {
    addWrapped(lines, 'Pris enligt det publicerade erbjudande som accepterades när avtalet tecknades.')
  }

  if (input.withdrawalDeadline) {
    lines.push({ text: '' })
    lines.push({ text: 'ÅNGERRÄTT', style: 'heading' })
    addWrapped(lines, `Din ångerfrist gäller till ${formatDateTime(input.withdrawalDeadline)}. Information om hur du använder ångerrätten finns i de villkor du accepterade.`)
  }

  lines.push({ text: '' })
  lines.push({ text: 'ACCEPTERADE VILLKOR OCH DOKUMENT', style: 'heading' })
  if (input.legalVersions.length === 0) {
    lines.push({ text: 'Inga separata juridiska dokument registrerades.' })
  } else {
    for (const version of input.legalVersions) {
      addWrapped(lines, `- ${version.title}${version.version ? ` (version ${version.version})` : ''}`, 'small', 88)
    }
  }
  addWrapped(lines, 'De fullständiga, versionslåsta dokumenten finns bevarade tillsammans med ditt avtal. Den här bekräftelsen återger kunduppgifterna och de kommersiella huvudvillkoren utan interna system- eller bevisuppgifter.', 'small', 88)

  lines.push({ text: '' })
  lines.push({ text: 'AVTALSPART OCH KONTAKT', style: 'heading' })
  lines.push({ text: `${input.companyName} · Org.nr ${input.organizationNumber ?? '-'}` })
  addWrapped(lines, address)
  lines.push({ text: `Kundservice: ${input.companySupportEmail ?? '-'}${input.companyPhone ? ` · ${input.companyPhone}` : ''}` })
  if (input.companyWebsite) lines.push({ text: `Webbplats: ${input.companyWebsite}` })

  lines.push({ text: '' })
  addWrapped(lines, `Bekräftelsen är digitalt skapad och hör till avtal ${input.contractNumber}. Tekniska versions- och signaturbevis lagras säkert separat och visas inte i kunddokumentet.`, 'small', 88)

  return lines
}

function lineMetrics(style: PdfLine['style']) {
  if (style === 'title') return { font: 'F2', size: 20, leading: 26 }
  if (style === 'heading') return { font: 'F2', size: 11, leading: 17 }
  if (style === 'small') return { font: 'F1', size: 8.5, leading: 12 }
  return { font: 'F1', size: 10, leading: 14 }
}

function contentStream(lines: PdfLine[]) {
  const commands = ['BT', '48 792 Td']
  let currentFont = ''
  let currentSize = 0
  for (const line of lines) {
    const metrics = lineMetrics(line.style)
    if (metrics.font !== currentFont || metrics.size !== currentSize) {
      commands.push(`/${metrics.font} ${metrics.size} Tf`)
      currentFont = metrics.font
      currentSize = metrics.size
    }
    commands.push(`0 -${metrics.leading} Td`)
    commands.push(`(${escapePdfString(line.text)}) Tj`)
  }
  commands.push('ET')
  return Buffer.from(commands.join('\n'), 'latin1')
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = []
  let page: PdfLine[] = []
  let usedHeight = 0
  const maxHeight = 700

  for (const line of lines) {
    const metrics = lineMetrics(line.style)
    if (page.length > 0 && usedHeight + metrics.leading > maxHeight) {
      pages.push(page)
      page = []
      usedHeight = 0
    }
    page.push(line)
    usedHeight += metrics.leading
  }
  if (page.length > 0) pages.push(page)
  return pages.length > 0 ? pages : [[{ text: 'AVTALSBEKRÄFTELSE', style: 'title' }]]
}

export function buildAgreementPdfBuffer(input: AgreementPdfInput): Buffer {
  return buildLinesPdfBuffer(agreementLines(input))
}

/** Wraps free text into PDF lines of the given style (shared by all generated documents). */
export function wrapPdfLines(text: string, style: PdfLine['style'] = 'body', maxLength = 82): PdfLine[] {
  const lines: PdfLine[] = []
  addWrapped(lines, text, style, maxLength)
  return lines
}

/** Renders prepared lines into a self-contained A4 PDF (Helvetica, WinAnsi), paginated. */
export function buildLinesPdfBuffer(lines: PdfLine[]): Buffer {
  const pages = paginate(lines)

  const objects: Buffer[] = []
  const addObject = (body: Buffer | string) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'))
    return objects.length
  }

  const catalogId = addObject('')
  const pagesId = addObject('')
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds: number[] = []

  for (const lines of pages) {
    const stream = contentStream(lines)
    const contentId = addObject(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]))
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`)
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
