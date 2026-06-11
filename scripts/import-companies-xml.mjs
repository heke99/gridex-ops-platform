#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/import-companies-xml.mjs <companies.xml> > companies-import.sql')
  process.exit(1)
}

const xml = readFileSync(filePath, 'utf8')
const generatedAt = attr(xml.match(/<Header\b[^>]*>/)?.[0] ?? '', 'GeneratedAt') ?? new Date().toISOString()
const companies = [...xml.matchAll(/<Company>([\s\S]*?)<\/Company>/g)].map((match) => parseCompany(match[1])).filter((company) => company.name)

function attr(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null
}

function text(block, tag) {
  const value = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]
  return value ? decodeXml(value.trim()) : null
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function jsonSql(value) {
  return `${sql(JSON.stringify(value))}::jsonb`
}

function normaliseRole(role) {
  const raw = String(role ?? '').trim()
  const lookup = raw.toLowerCase()
  if (lookup === 'netowner' || lookup === 'gridowner' || lookup === 'networkowner') return 'grid_owner'
  if (lookup === 'powersupplier' || lookup === 'supplier') return 'electricity_supplier'
  if (lookup === 'balanceresponsibleparty' || lookup === 'brp') return 'balance_responsible_party'
  if (lookup === 'systemsupplier') return 'system_supplier'
  if (lookup === 'esco' || lookup === 'energyservicecompany') return 'energy_service_company'
  return raw || 'other'
}

function parseCompany(block) {
  const name = text(block, 'Name')
  const identifiers = [...block.matchAll(/<Key\s+Type="([^"]+)">([\s\S]*?)<\/Key>/g)].map((match) => ({
    type: decodeXml(match[1].trim()),
    value: decodeXml(match[2].trim()),
  })).filter((identifier) => identifier.type && identifier.value)
  const roles = [...block.matchAll(/<Role>([\s\S]*?)<\/Role>/g)].map((match) => decodeXml(match[1].trim())).filter(Boolean)
  const routes = [...block.matchAll(/<EDIFACTDetails\s+Type="([^"]+)">([\s\S]*?)<\/EDIFACTDetails>/g)].map((match) => {
    const detail = match[2]
    const communicationTag = detail.match(/<CommunicationAddress\b[^>]*>[\s\S]*?<\/CommunicationAddress>/)?.[0] ?? ''
    const interchangeTag = detail.match(/<InterchangePartyId\b[^>]*>[\s\S]*?<\/InterchangePartyId>/)?.[0] ?? ''
    const partyTag = detail.match(/<PartyId\b[^>]*>[\s\S]*?<\/PartyId>/)?.[0] ?? ''
    return {
      messageFamily: decodeXml(match[1].trim()).toUpperCase(),
      subaddress: text(detail, 'SubAddress'),
      ediCharset: text(detail, 'EDICharset'),
      ediSyntax: text(detail, 'EDISyntax'),
      communicationType: attr(communicationTag, 'Type'),
      communicationAddress: text(detail, 'CommunicationAddress'),
      interchangePartyId: text(detail, 'InterchangePartyId'),
      interchangeQualifier: attr(interchangeTag, 'IdCodeQualifier'),
      partyId: text(detail, 'PartyId'),
      partyQualifier: attr(partyTag, 'IdCodeQualifier'),
      partyResponsible: attr(partyTag, 'IdCodeResponsible'),
    }
  }).filter((route) => route.messageFamily)

  const byType = Object.fromEntries(identifiers.map((identifier) => [identifier.type, identifier.value]))
  return {
    name,
    edielId: byType.EdielId ?? null,
    orgNumber: byType.OrgNo ?? null,
    eic: byType.EIC ?? null,
    svkId: byType.SvKId ?? null,
    identifiers,
    roles,
    routes,
  }
}

function actorIdSql(name) {
  return `(select id from public.platform_market_actors where normalized_name = lower(regexp_replace(coalesce(${sql(name)}, ''), '\\s+', ' ', 'g')) limit 1)`
}

function companySql(company, index) {
  const metadata = {
    importedFrom: basename(filePath),
    generatedAt,
    edielId: company.edielId,
    eic: company.eic,
    svkId: company.svkId,
    roles: company.roles,
  }
  const visible = company.roles.map(normaliseRole).some((role) => ['grid_owner', 'electricity_supplier'].includes(role))
  const matchStatus = company.edielId || company.orgNumber ? 'strong_suggestion' : 'needs_review'
  const actorId = actorIdSql(company.name)
  const lines = []
  lines.push(`-- ${index + 1}. ${company.name}`)
  lines.push(`insert into public.platform_market_actors (name, org_number, legal_name, status, match_status, source, source_reference, visible_to_tenants, metadata, imported_at, updated_at)`)
  lines.push(`values (${sql(company.name)}, ${sql(company.orgNumber)}, ${sql(company.name)}, 'active', ${sql(matchStatus)}, 'companies_xml', ${sql(generatedAt)}, ${visible ? 'true' : 'false'}, ${jsonSql(metadata)}, now(), now())`)
  lines.push(`on conflict (normalized_name) do update set`)
  lines.push(`  org_number = coalesce(excluded.org_number, public.platform_market_actors.org_number),`)
  lines.push(`  legal_name = excluded.legal_name,`)
  lines.push(`  status = excluded.status,`)
  lines.push(`  match_status = case when public.platform_market_actors.match_status = 'verified' then public.platform_market_actors.match_status else excluded.match_status end,`)
  lines.push(`  source = excluded.source,`)
  lines.push(`  source_reference = excluded.source_reference,`)
  lines.push(`  visible_to_tenants = public.platform_market_actors.visible_to_tenants or excluded.visible_to_tenants,`)
  lines.push(`  metadata = public.platform_market_actors.metadata || excluded.metadata,`)
  lines.push(`  imported_at = now(), updated_at = now();`)

  for (const identifier of company.identifiers) {
    lines.push(`insert into public.platform_actor_identifiers (actor_id, identifier_type, identifier_value, source, is_verified, metadata, updated_at)`)
    lines.push(`values (${actorId}, ${sql(identifier.type)}, ${sql(identifier.value)}, 'companies_xml', true, ${jsonSql({ generatedAt })}, now())`)
    lines.push(`on conflict (identifier_type, identifier_value) do update set actor_id = excluded.actor_id, is_verified = true, updated_at = now();`)
  }

  const roleSet = new Set(company.roles.map(normaliseRole))
  for (const role of roleSet) {
    lines.push(`insert into public.platform_actor_roles (actor_id, actor_role, role_source, is_active, metadata, updated_at)`)
    lines.push(`values (${actorId}, ${sql(role)}, 'companies_xml', true, ${jsonSql({ rawRoles: company.roles })}, now())`)
    lines.push(`on conflict (actor_id, actor_role) do update set is_active = true, updated_at = now();`)
  }

  if (roleSet.has('grid_owner')) {
    const communicationEmail = company.routes.find((route) => route.communicationAddress)?.communicationAddress ?? null
    lines.push(`insert into public.platform_grid_owners (name, org_number, ediel_id, communication_email, source, metadata, updated_at)`)
    lines.push(`values (${sql(company.name)}, ${sql(company.orgNumber)}, ${sql(company.edielId)}, ${sql(communicationEmail)}, 'companies_xml', ${jsonSql({ generatedAt, actorRegistryName: company.name })}, now())`)
    lines.push(`on conflict (lower(name)) do update set org_number = coalesce(excluded.org_number, public.platform_grid_owners.org_number), ediel_id = coalesce(excluded.ediel_id, public.platform_grid_owners.ediel_id), communication_email = coalesce(excluded.communication_email, public.platform_grid_owners.communication_email), source = excluded.source, metadata = public.platform_grid_owners.metadata || excluded.metadata, updated_at = now();`)
  }

  lines.push(`insert into public.platform_actor_aliases (actor_id, alias, alias_source, confidence, is_verified, metadata)`)
  lines.push(`values (${actorId}, ${sql(company.name)}, 'companies_xml', 1, true, ${jsonSql({ generatedAt })})`)
  lines.push(`on conflict (actor_id, normalized_alias) do update set is_verified = true;`)

  for (const route of company.routes) {
    const routeMetadata = { generatedAt, edielId: company.edielId, sourceFile: basename(filePath) }
    lines.push(`insert into public.platform_actor_routes (actor_id, message_family, environment, subaddress, communication_type, communication_address, edi_charset, edi_syntax, party_id, party_id_qualifier, party_id_responsible, interchange_party_id, interchange_id_qualifier, requires_poa, is_verified, auto_send_allowed, status, source, metadata, updated_at)`)
    lines.push(`values (${actorId}, ${sql(route.messageFamily)}, 'production', ${sql(route.subaddress)}, ${sql(route.communicationType)}, ${sql(route.communicationAddress)}, ${sql(route.ediCharset)}, ${sql(route.ediSyntax)}, ${sql(route.partyId)}, ${sql(route.partyQualifier)}, ${sql(route.partyResponsible)}, ${sql(route.interchangePartyId)}, ${sql(route.interchangeQualifier)}, true, false, false, 'needs_review', 'companies_xml', ${jsonSql(routeMetadata)}, now())`)
    lines.push(`on conflict (actor_id, upper(message_family), environment, coalesce(subaddress, ''), coalesce(communication_address, '')) do update set communication_type = excluded.communication_type, edi_charset = excluded.edi_charset, edi_syntax = excluded.edi_syntax, party_id = excluded.party_id, party_id_qualifier = excluded.party_id_qualifier, party_id_responsible = excluded.party_id_responsible, interchange_party_id = excluded.interchange_party_id, interchange_id_qualifier = excluded.interchange_id_qualifier, metadata = public.platform_actor_routes.metadata || excluded.metadata, updated_at = now();`)
  }

  if (company.routes.length === 0) {
    lines.push(`insert into public.platform_actor_import_issues (actor_id, issue_type, severity, status, message, metadata)`)
    lines.push(`values (${actorId}, 'missing_route', 'warning', 'open', 'Aktören saknar EDIFACT-route i companies.xml och kan inte autosändas innan route verifieras.', ${jsonSql({ name: company.name, edielId: company.edielId })});`)
  }
  if (!company.edielId) {
    lines.push(`insert into public.platform_actor_import_issues (actor_id, issue_type, severity, status, message, metadata)`)
    lines.push(`values (${actorId}, 'missing_identifier', 'blocking', 'open', 'Aktören saknar EdielId i companies.xml.', ${jsonSql({ name: company.name })});`)
  }

  return lines.join('\n')
}

console.log('-- Generated by scripts/import-companies-xml.mjs')
console.log(`-- Source: ${filePath}`)
console.log(`-- Companies: ${companies.length}`)
console.log('begin;')
console.log(`insert into public.platform_actor_import_runs (source, import_type, status, records_seen, records_upserted, safe, completed_at, metadata)`)
console.log(`values (${sql(basename(filePath))}, 'companies_xml', 'completed_with_warnings', ${companies.length}, ${companies.length}, true, now(), ${jsonSql({ generatedAt, generatedBy: 'scripts/import-companies-xml.mjs' })});`)
for (const [index, company] of companies.entries()) console.log(companySql(company, index))
console.log('commit;')
