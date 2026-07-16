import crypto from 'node:crypto'

import { supabaseService } from '@/lib/supabase/service'
import { REQUIRED_LEGAL_TEXT_TYPES, type LegalTextType } from '@/lib/opsMaster/readiness'

export type PlatformLegalTemplate = {
  id: string
  type: LegalTextType | string
  version: string
  title: string
  body: string
  status: 'draft' | 'published' | 'archived' | string
  published_at: string | null
  created_at: string | null
  updated_at: string | null
  metadata: Record<string, unknown> | null
}

export type LegalTemplateCompany = {
  id: string
  name: string | null
  slug: string | null
  org_number: string | null
  primary_contact_email: string | null
  support_email: string | null
  phone: string | null
  website: string | null
  address_line_1: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  country_code: string | null
  branding: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  status: string | null
}

export type RenderedTenantLegalTemplate = {
  title: string
  body: string
  placeholdersUsed: Record<string, string>
  missingPlaceholders: string[]
  checksum: string
}

export type CopyTemplateResult = {
  companyId: string
  inserted: number
  skipped: number
  missingTemplates: string[]
  createdVersionIds: string[]
}

export const LEGAL_TEMPLATE_PLACEHOLDERS = [
  'company_name',
  'legal_name',
  'brand_name',
  'org_number',
  'support_email',
  'contact_email',
  'phone',
  'website',
  'address_line_1',
  'address_line_2',
  'postal_code',
  'city',
  'country',
] as const

const COMPANY_TEMPLATE_COLUMNS =
  'id,name,slug,company_slug,org_number,primary_contact_email,support_email,phone,website,address_line_1,address_line_2,postal_code,city,country_code,branding,metadata,status'

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned.length > 0 ? cleaned : null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = textValue(value)
    if (cleaned) return cleaned
  }
  return null
}

function stableChecksum(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function normalizeTemplateRow(row: Record<string, unknown>): PlatformLegalTemplate {
  return {
    id: String(row.id),
    type: String(row.type),
    version: String(row.version ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    status: String(row.status ?? 'draft'),
    published_at: (row.published_at as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    metadata: objectValue(row.metadata),
  }
}

function normalizeCompanyRow(row: Record<string, unknown>): LegalTemplateCompany {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    slug: ((row.slug as string | null) ?? (row.company_slug as string | null)) ?? null,
    org_number: (row.org_number as string | null) ?? null,
    primary_contact_email: (row.primary_contact_email as string | null) ?? null,
    support_email: (row.support_email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    address_line_1: (row.address_line_1 as string | null) ?? null,
    address_line_2: (row.address_line_2 as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    country_code: (row.country_code as string | null) ?? null,
    branding: objectValue(row.branding),
    metadata: objectValue(row.metadata),
    status: (row.status as string | null) ?? null,
  }
}

export function legalTemplatePlaceholderValues(company: LegalTemplateCompany): Record<string, string> {
  const branding = company.branding ?? {}
  const metadata = company.metadata ?? {}
  const companyName = firstText(company.name, metadata.company_name, metadata.legal_name) ?? ''
  const brandName = firstText(branding.brand_name, branding.display_name, branding.name, metadata.brand_name, company.name) ?? companyName
  const contactEmail = firstText(company.support_email, company.primary_contact_email, metadata.contact_email) ?? ''

  return {
    company_name: companyName,
    legal_name: firstText(metadata.legal_name, company.name) ?? companyName,
    brand_name: brandName,
    org_number: firstText(company.org_number, metadata.org_number) ?? '',
    support_email: firstText(company.support_email, metadata.support_email, company.primary_contact_email) ?? '',
    contact_email: contactEmail,
    phone: firstText(company.phone, metadata.phone) ?? '',
    website: firstText(company.website, metadata.website) ?? '',
    address_line_1: firstText(company.address_line_1, metadata.address_line_1) ?? '',
    address_line_2: firstText(company.address_line_2, metadata.address_line_2) ?? '',
    postal_code: firstText(company.postal_code, metadata.postal_code) ?? '',
    city: firstText(company.city, metadata.city) ?? '',
    country: firstText(company.country_code, metadata.country, metadata.country_code) ?? 'SE',
  }
}

export function renderTenantLegalTemplate(
  template: Pick<PlatformLegalTemplate, 'title' | 'body'>,
  company: LegalTemplateCompany,
): RenderedTenantLegalTemplate {
  const values = legalTemplatePlaceholderValues(company)
  const missing = new Set<string>()

  const render = (input: string): string => input.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key: string) => {
    const normalized = key.trim()
    if (!Object.prototype.hasOwnProperty.call(values, normalized)) {
      missing.add(normalized)
      return match
    }
    const value = values[normalized]
    if (!value) missing.add(normalized)
    return value || match
  })

  const title = render(template.title)
  const body = render(template.body)

  return {
    title,
    body,
    placeholdersUsed: values,
    missingPlaceholders: Array.from(missing).sort(),
    checksum: stableChecksum(`${title}\n${body}`),
  }
}

export async function listPlatformLegalTemplates(): Promise<PlatformLegalTemplate[]> {
  const { data, error } = await supabaseService
    .from('platform_default_legal_templates')
    .select('id,type,version,title,body,status,published_at,created_at,updated_at,metadata')
    .order('type', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(normalizeTemplateRow)
}

export async function listPublishedPlatformLegalTemplates(): Promise<PlatformLegalTemplate[]> {
  const { data, error } = await supabaseService
    .from('platform_default_legal_templates')
    .select('id,type,version,title,body,status,published_at,created_at,updated_at,metadata')
    .eq('status', 'published')
    .in('type', [...REQUIRED_LEGAL_TEXT_TYPES])
    .order('type', { ascending: true })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  const latestByType = new Map<string, PlatformLegalTemplate>()
  for (const row of ((data ?? []) as Array<Record<string, unknown>>).map(normalizeTemplateRow)) {
    if (!latestByType.has(row.type)) latestByType.set(row.type, row)
  }
  return Array.from(latestByType.values())
}

export async function listLegalTemplateCompanies(limit = 500): Promise<LegalTemplateCompany[]> {
  const { data, error } = await supabaseService
    .from('companies')
    .select(COMPANY_TEMPLATE_COLUMNS)
    .neq('status', 'deleted_test_only')
    .order('name', { ascending: true })
    .limit(limit)

  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(normalizeCompanyRow)
}

export async function loadLegalTemplateCompany(companyId: string): Promise<LegalTemplateCompany | null> {
  const { data, error } = await supabaseService
    .from('companies')
    .select(COMPANY_TEMPLATE_COLUMNS)
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  return data ? normalizeCompanyRow(data as Record<string, unknown>) : null
}

async function ensurePublishedLegalBundleForCompany(input: {
  companyId: string
  actorUserId: string | null
  source: string
}): Promise<string | null> {
  const { data: existingBundle, error: existingError } = await supabaseService
    .from('legal_bundles')
    .select('id,metadata')
    .eq('company_id', input.companyId)
    .in('status', ['published', 'active'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  let bundleId = typeof existingBundle?.id === 'string' ? existingBundle.id : null
  if (!bundleId) {
    const { data: insertedBundle, error: insertError } = await supabaseService
      .from('legal_bundles')
      .insert({
        company_id: input.companyId,
        name: 'Tenant legal bundle',
        status: 'published',
        metadata: {
          source: input.source,
          auto_created: true,
          created_from: 'platform_legal_templates',
          created_by: input.actorUserId,
        },
      })
      .select('id')
      .single()
    if (insertError) throw insertError
    bundleId = insertedBundle.id
  }

  const { data: versions, error: versionsError } = await supabaseService
    .from('legal_text_versions')
    .select('id,type,published_at,created_at')
    .eq('company_id', input.companyId)
    .eq('status', 'published')
    .in('type', [...REQUIRED_LEGAL_TEXT_TYPES])
    .order('type', { ascending: true })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (versionsError) throw versionsError

  const latestByType = new Map<string, { id: string; type: string }>()
  for (const row of (versions ?? []) as Array<{ id: string; type: string }>) {
    if (!latestByType.has(row.type)) latestByType.set(row.type, row)
  }

  for (const type of REQUIRED_LEGAL_TEXT_TYPES) {
    const version = latestByType.get(type)
    if (!version) continue

    const { data: existingItem, error: itemLookupError } = await supabaseService
      .from('legal_bundle_items')
      .select('id')
      .eq('legal_bundle_id', bundleId)
      .eq('type', type)
      .limit(1)
      .maybeSingle()

    if (itemLookupError) throw itemLookupError

    const payload = {
      legal_bundle_id: bundleId,
      legal_text_version_id: version.id,
      type,
      sort_order: type === 'terms' ? 10 : type === 'privacy_policy' ? 20 : type === 'withdrawal' ? 30 : type === 'price_terms' ? 40 : 50,
    }

    if (existingItem?.id) {
      const { error: updateError } = await supabaseService
        .from('legal_bundle_items')
        .update({ legal_text_version_id: version.id, sort_order: payload.sort_order, updated_at: new Date().toISOString() })
        .eq('id', existingItem.id)
      if (updateError) throw updateError
    } else {
      const { error: insertItemError } = await supabaseService.from('legal_bundle_items').insert(payload)
      if (insertItemError) throw insertItemError
    }
  }

  return bundleId
}

export async function copyPublishedTemplatesToCompany(input: {
  companyId: string
  actorUserId: string | null
  onlyMissing?: boolean
  publishNow?: boolean
  templateTypes?: string[]
  source?: string
}): Promise<CopyTemplateResult> {
  const company = await loadLegalTemplateCompany(input.companyId)
  if (!company) throw new Error('Company not found.')

  const types = input.templateTypes?.length ? input.templateTypes : [...REQUIRED_LEGAL_TEXT_TYPES]
  const templates = (await listPublishedPlatformLegalTemplates()).filter((template) => types.includes(template.type))
  const byType = new Map(templates.map((template) => [template.type, template]))

  let inserted = 0
  let skipped = 0
  const missingTemplates: string[] = []
  const createdVersionIds: string[] = []

  for (const type of types) {
    const template = byType.get(type)
    if (!template) {
      missingTemplates.push(type)
      continue
    }

    if (input.onlyMissing !== false) {
      const { data: existing, error: existingError } = await supabaseService
        .from('legal_text_versions')
        .select('id')
        .eq('company_id', company.id)
        .eq('type', type)
        .eq('status', 'published')
        .limit(1)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing?.id) {
        skipped += 1
        continue
      }
    }

    const rendered = renderTenantLegalTemplate(template, company)
    const metadata = {
      source: input.source ?? 'platform_template',
      origin: 'platform_template',
      template_key: type,
      template_version: template.version,
      tenant_customized: false,
      copied_from_platform_default_id: template.id,
      copied_from_platform_version: template.version,
      inherited_from_platform: true,
      placeholders_used: rendered.placeholdersUsed,
      missing_placeholders: rendered.missingPlaceholders,
      checksum: rendered.checksum,
      rendered_at: new Date().toISOString(),
    }

    const { data, error } = await supabaseService
      .from('legal_text_versions')
      .insert({
        company_id: company.id,
        type,
        version: template.version,
        title: rendered.title,
        body: rendered.body,
        status: input.publishNow === false ? 'draft' : 'published',
        published_at: input.publishNow === false ? null : new Date().toISOString(),
        created_by: input.actorUserId,
        updated_by: input.actorUserId,
        published_by: input.publishNow === false ? null : input.actorUserId,
        metadata,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        skipped += 1
        continue
      }
      throw error
    }

    inserted += 1
    createdVersionIds.push(data.id)
  }

  if (input.publishNow !== false && missingTemplates.length === 0) {
    await ensurePublishedLegalBundleForCompany({
      companyId: company.id,
      actorUserId: input.actorUserId,
      source: input.source ?? 'platform_template',
    })
  }

  return { companyId: company.id, inserted, skipped, missingTemplates, createdVersionIds }
}

export async function copyPublishedTemplatesToCompanies(input: {
  companyIds: string[]
  actorUserId: string | null
  onlyMissing?: boolean
  publishNow?: boolean
  templateTypes?: string[]
  source?: string
}): Promise<CopyTemplateResult[]> {
  const uniqueIds = Array.from(new Set(input.companyIds.filter(Boolean)))
  const results: CopyTemplateResult[] = []
  for (const companyId of uniqueIds) {
    results.push(await copyPublishedTemplatesToCompany({ ...input, companyId }))
  }
  return results
}

export function summarizeCopyResults(results: CopyTemplateResult[]): string {
  const inserted = results.reduce((sum, row) => sum + row.inserted, 0)
  const skipped = results.reduce((sum, row) => sum + row.skipped, 0)
  const missing = Array.from(new Set(results.flatMap((row) => row.missingTemplates)))
  const parts = [`${inserted} legal version(s) created`, `${skipped} skipped`]
  if (missing.length > 0) parts.push(`missing master templates: ${missing.join(', ')}`)
  return parts.join(' · ')
}
