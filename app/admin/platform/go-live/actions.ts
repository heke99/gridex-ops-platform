'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import {
  REQUIRED_PRODUCTION_EVIDENCE,
  recordEdielCertificationEvidence,
  type EdielCertificationEvidenceType,
} from '@/lib/ediel/certificationEvidence'
import { provisionTenantWebsiteIntegration } from '@/lib/integrations/tenantWebsiteProvisioning'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function optionalIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Ogiltigt datum.')
  return date.toISOString()
}

function validHttpsUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Adressen är inte en giltig URL.')
  }
  if (url.protocol !== 'https:') throw new Error('Production-adresser måste använda https://.')
  return url.toString()
}

function parseOrigins(value: string): string[] {
  const raw = value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean)
  const origins = raw.map((item) => {
    const url = new URL(validHttpsUrl(item))
    return url.origin
  })
  return Array.from(new Set(origins))
}

function returnPath(companyId: string) {
  return `/admin/platform/go-live/${companyId}`
}

function finish(companyId: string, status: 'prepared' | 'blocked' | 'error', message: string): never {
  const params = new URLSearchParams({ status, message })
  redirect(`${returnPath(companyId)}?${params.toString()}`)
  throw new Error('redirect_failed')
}

export async function saveCertificationEvidenceAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData, 'company_id')
  const evidenceType = text(formData, 'evidence_type').toUpperCase() as EdielCertificationEvidenceType
  const status = text(formData, 'evidence_status') || 'passed'
  const externalReference = text(formData, 'external_reference')
  const evidenceDocumentReference = text(formData, 'evidence_document_reference')
  const testedAtRaw = text(formData, 'tested_at')
  const validUntilRaw = text(formData, 'valid_until')
  const reason = text(formData, 'reason')

  if (!companyId) throw new Error('Bolag saknas.')
  if (!REQUIRED_PRODUCTION_EVIDENCE.includes(evidenceType)) throw new Error('Ogiltig evidenstyp.')
  if (!['pending', 'passed', 'failed', 'revoked'].includes(status)) throw new Error('Ogiltig evidensstatus.')

  if (status === 'passed') {
    if (text(formData, 'confirmation') !== 'APPROVE EVIDENCE') {
      finish(companyId, 'error', 'Skriv APPROVE EVIDENCE för att attestera ett externt production-bevis.')
    }
    if (!externalReference || !evidenceDocumentReference || !testedAtRaw) {
      finish(companyId, 'error', 'Godkänd evidens kräver extern referens, dokument-/bevisreferens och testdatum.')
    }
  } else if (!reason) {
    finish(companyId, 'error', 'Orsak krävs när evidensen inte markeras godkänd.')
  }

  const row = await recordEdielCertificationEvidence({
    companyId,
    evidenceType,
    status: status as 'pending' | 'passed' | 'failed' | 'revoked',
    externalReference: externalReference || null,
    evidenceDocumentReference: evidenceDocumentReference || null,
    testedAt: optionalIso(testedAtRaw),
    validUntil: optionalIso(validUntilRaw),
    approvedBy: status === 'passed' ? admin.userId : null,
    metadata: {
      source: 'platform_go_live_superadmin',
      reason: reason || null,
      actor_email: admin.email ?? null,
    },
  })

  const entityId = String((row as { id?: unknown }).id ?? '').trim()
  if (!entityId) throw new Error('certification_evidence_id_missing')

  await logAdminActionAndUsage({
    companyId,
    actorUserId: admin.userId,
    action: `certification_evidence.${status}`,
    label: `Production-evidens ${evidenceType}: ${status}`,
    entityType: 'ediel_certification_evidence',
    entityId,
    source: 'platform_go_live_superadmin',
    metadata: {
      evidence_type: evidenceType,
      external_reference: externalReference || null,
      evidence_document_reference: evidenceDocumentReference || null,
      tested_at: optionalIso(testedAtRaw),
      valid_until: optionalIso(validUntilRaw),
    },
  })

  revalidatePath(returnPath(companyId))
  finish(companyId, 'prepared', `${evidenceType} sparades som ${status}. Readiness räknas om på sidan.`)
}

export async function verifyTenantWebsiteGoLiveAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData, 'company_id')
  if (!companyId) throw new Error('Bolag saknas.')

  const customerPortalUrl = validHttpsUrl(text(formData, 'customer_portal_url'))
  const allowedOrigins = parseOrigins(text(formData, 'allowed_origins'))
  if (allowedOrigins.length === 0) {
    finish(companyId, 'error', 'Minst en tillåten https-origin krävs för hemsidan.')
  }

  const { data: currentClient, error: clientError } = await supabaseService
    .from('integration_api_clients')
    .select('id,name,rate_limit_per_minute')
    .eq('company_id', companyId)
    .eq('profile_key', 'tenant_website')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (clientError) throw clientError

  if (!currentClient) {
    finish(
      companyId,
      'blocked',
      'Ingen hemside-API-klient finns ännu. Skapa först tenant_website-klienten från API-klientsidan så att den nya nyckeln kan visas exakt en gång, och kör därefter verifieringen här.',
    )
  }

  const provisioned = await provisionTenantWebsiteIntegration({
    companyId,
    actorUserId: admin.userId,
    idempotencyKey: `tenant-website:${companyId}:production`,
    environment: 'production',
    clientName: currentClient.name,
    allowedOrigins,
    rateLimitPerMinute: currentClient.rate_limit_per_minute ?? 120,
    customerPortalUrl,
    webhook: null,
  })

  await logAdminActionAndUsage({
    companyId,
    actorUserId: admin.userId,
    action: provisioned.launchReady
      ? 'tenant_website.go_live_verified'
      : 'tenant_website.go_live_blocked',
    label: provisioned.launchReady
      ? 'Webb & Mina sidor verifierad'
      : 'Webb & Mina sidor blockerad',
    entityType: 'integration_api_client',
    entityId: provisioned.apiClientId,
    source: 'platform_go_live_superadmin',
    metadata: {
      receipt_id: provisioned.receiptId,
      reused_existing_client: provisioned.reusedExistingClient,
      allowed_origins: allowedOrigins,
      customer_portal_url: customerPortalUrl,
      launch_ready: provisioned.launchReady,
      readiness_blockers: provisioned.readinessBlockers,
      readiness_warnings: provisioned.readinessWarnings,
      contract_schema_version: provisioned.contractSchemaVersion,
    },
  })

  revalidatePath(returnPath(companyId))
  revalidatePath('/admin/platform/api-clients')

  if (!provisioned.launchReady) {
    const blockers = provisioned.readinessBlockers.map((item) => item.message).join(' · ')
    finish(companyId, 'blocked', blockers || 'Webb & Mina sidor är fortfarande blockerade efter verifieringen.')
  }

  finish(
    companyId,
    'prepared',
    'Webb & Mina sidor verifierades med befintlig API-nyckel. Ingen credential roterades.',
  )
}
