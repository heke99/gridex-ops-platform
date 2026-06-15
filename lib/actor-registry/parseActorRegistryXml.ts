import type { ParsedActorRegistryActor, ActorRegistryRoute, ActorRegistryCertificate } from '@/lib/actor-registry/types'
import {
  cleanString,
  normalizeEdielId,
  normalizeEmail,
  normalizeEic,
  normalizeOrgNumber,
  normalizeRole,
  normalizeSubaddress,
  uniqueStrings,
} from '@/lib/actor-registry/normalizeActor'

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripTags(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function tagValue(xml: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i')
    const match = xml.match(pattern)
    if (match?.[1]) return cleanString(stripTags(match[1]))
  }
  return null
}

function attrValue(xml: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i')
    const match = xml.match(pattern)
    if (match?.[1]) return cleanString(decodeXml(match[1]))
  }
  return null
}

function tagBlocks(xml: string, names: string[]): string[] {
  const blocks: string[] = []
  for (const name of names) {
    const pattern = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${name}>`, 'gi')
    for (const match of xml.matchAll(pattern)) blocks.push(match[0])
  }
  return blocks
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const clean = cleanString(value)
    if (clean) return clean
  }
  return null
}

function inferRoles(block: string): ParsedActorRegistryActor['roles'] {
  const roleValues = [
    ...tagBlocks(block, ['Role', 'ActorRole', 'MarketRole', 'role', 'marketRole']).map((item) => firstNonEmpty(tagValue(item, ['Code', 'Name', 'Value']), stripTags(item))),
    attrValue(block, ['role', 'actorRole', 'marketRole']),
  ]
  const roles = uniqueStrings(roleValues.map(normalizeRole))
  return roles.length > 0 ? roles : ['other']
}

function normalizeEnvironment(value: string | null): 'test' | 'production' {
  const lower = cleanString(value)?.toLowerCase()
  return lower === 'test' || lower === 't' || lower === 'qa' ? 'test' : 'production'
}

function normalizeMessageFamily(value: string | null): string {
  const upper = cleanString(value)?.toUpperCase()
  if (upper === 'PRODAT' || upper === 'UTILTS') return upper
  return upper ?? 'PRODAT'
}

function parseRoutes(block: string, actorEdielId: string | null): ActorRegistryRoute[] {
  const routeBlocks = tagBlocks(block, ['Route', 'CommunicationRoute', 'Routing', 'Communication'])
  const routes: ActorRegistryRoute[] = []

  for (const routeBlock of routeBlocks) {
    const communicationAddress = normalizeEmail(firstNonEmpty(
      tagValue(routeBlock, ['SmtpEmail', 'SMTP', 'Email', 'Address', 'CommunicationAddress', 'Mailbox']),
      attrValue(routeBlock, ['smtpEmail', 'email', 'communicationAddress', 'address']),
    ))
    const messageFamily = normalizeMessageFamily(firstNonEmpty(
      tagValue(routeBlock, ['MessageFamily', 'MessageType', 'ApplicationReference', 'Application']),
      attrValue(routeBlock, ['messageFamily', 'messageType', 'applicationReference', 'application']),
    ))
    const subaddress = normalizeSubaddress(firstNonEmpty(
      tagValue(routeBlock, ['SubAddress', 'Subaddress', 'Subadress']),
      attrValue(routeBlock, ['subaddress', 'subAddress', 'subadress']),
    ))
    const environment = normalizeEnvironment(firstNonEmpty(tagValue(routeBlock, ['Environment', 'Env']), attrValue(routeBlock, ['environment', 'env'])))
    const partyId = normalizeEdielId(firstNonEmpty(tagValue(routeBlock, ['PartyId', 'EdielId', 'ActorId']), attrValue(routeBlock, ['partyId', 'edielId']))) ?? actorEdielId

    if (!communicationAddress && !subaddress && !partyId) continue
    routes.push({
      messageFamily,
      environment,
      subaddress,
      communicationType: communicationAddress ? 'smtp' : null,
      communicationAddress,
      partyId,
      interchangePartyId: partyId,
      status: 'active',
      isVerified: Boolean(partyId && (communicationAddress || subaddress !== null)),
      metadata: {
        source: 'xml_import',
        blankSubaddressImported: subaddress === null,
      },
    })
  }

  const fallbackEmail = normalizeEmail(tagValue(block, ['SmtpEmail', 'Email', 'CommunicationEmail']))
  if (routes.length === 0 && fallbackEmail) {
    routes.push({
      messageFamily: 'PRODAT',
      environment: 'production',
      subaddress: null,
      communicationType: 'smtp',
      communicationAddress: fallbackEmail,
      partyId: actorEdielId,
      interchangePartyId: actorEdielId,
      status: 'active',
      isVerified: Boolean(actorEdielId),
      metadata: { source: 'xml_import_fallback', blankSubaddressImported: true },
    })
  }

  return routes
}

function parseCertificates(block: string): ActorRegistryCertificate[] {
  const certBlocks = tagBlocks(block, ['Certificate', 'X509Certificate', 'PublicCertificate'])
  return certBlocks.map((certBlock) => ({
    environment: normalizeEnvironment(firstNonEmpty(tagValue(certBlock, ['Environment', 'Env']), attrValue(certBlock, ['environment', 'env']))),
    purpose: cleanString(firstNonEmpty(tagValue(certBlock, ['Purpose', 'Usage']), attrValue(certBlock, ['purpose', 'usage'])))?.toLowerCase() ?? 'encryption',
    pem: firstNonEmpty(tagValue(certBlock, ['PEM', 'Pem', 'CertificatePem', 'PublicCertificatePem']), stripTags(certBlock).includes('BEGIN CERTIFICATE') ? stripTags(certBlock) : null),
    fingerprintSha256: cleanString(firstNonEmpty(tagValue(certBlock, ['FingerprintSha256', 'SHA256', 'Fingerprint']), attrValue(certBlock, ['fingerprintSha256', 'sha256']))),
    validFrom: cleanString(tagValue(certBlock, ['ValidFrom', 'NotBefore'])),
    validTo: cleanString(tagValue(certBlock, ['ValidTo', 'NotAfter'])),
    subject: cleanString(tagValue(certBlock, ['Subject'])),
    issuer: cleanString(tagValue(certBlock, ['Issuer'])),
    serialNumber: cleanString(tagValue(certBlock, ['SerialNumber'])),
    metadata: { source: 'xml_import' },
  }))
}

function actorBlocks(xml: string): string[] {
  const direct = tagBlocks(xml, ['Actor', 'MarketActor', 'Company', 'Organisation', 'Organization'])
  if (direct.length > 0) return direct
  return [xml]
}

export function parseActorRegistryXml(xml: string): ParsedActorRegistryActor[] {
  const blocks = actorBlocks(xml)
  const actors: ParsedActorRegistryActor[] = []

  for (const block of blocks) {
    const name = firstNonEmpty(
      tagValue(block, ['Name', 'CompanyName', 'OrganisationName', 'OrganizationName', 'LegalName']),
      attrValue(block, ['name', 'companyName', 'legalName']),
    )
    const edielId = normalizeEdielId(firstNonEmpty(
      tagValue(block, ['EdielId', 'EdielID', 'EDIELID', 'Ediel', 'PartyId']),
      attrValue(block, ['edielId', 'edielID', 'partyId']),
    ))
    const orgNumber = normalizeOrgNumber(firstNonEmpty(
      tagValue(block, ['OrgNo', 'OrgNumber', 'OrganizationNumber', 'OrganisationNumber', 'CompanyRegistrationNumber']),
      attrValue(block, ['orgNo', 'orgNumber', 'organizationNumber']),
    ))
    const eic = normalizeEic(firstNonEmpty(tagValue(block, ['EIC', 'EicCode']), attrValue(block, ['eic', 'eicCode'])))

    if (!name && !edielId && !orgNumber && !eic) continue

    actors.push({
      name: name ?? edielId ?? orgNumber ?? 'Okänd aktör',
      legalName: tagValue(block, ['LegalName', 'RegisteredName']),
      edielId,
      orgNumber,
      eic,
      countryCode: cleanString(tagValue(block, ['Country', 'CountryCode'])) ?? 'SE',
      roles: inferRoles(block),
      routes: parseRoutes(block, edielId),
      certificates: parseCertificates(block),
      raw: {
        sourceFragmentLength: block.length,
        extractedWith: 'regex_xml_parser_v1',
      },
    })
  }

  return actors
}
