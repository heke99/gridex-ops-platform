'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { createCustomerCase, updateCustomerCaseStatus } from '@/lib/customer-cases/db'
import type { CustomerCaseType } from '@/lib/customer-cases/types'

export type CustomerCaseActionState = {
  ok: boolean
  message: string
}

function text(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function nullableText(value: FormDataEntryValue | null) {
  const normalized = text(value)
  return normalized || null
}

function bool(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').toLowerCase()
  return normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'yes'
}

function normalizeCaseType(value: string): CustomerCaseType {
  const allowed = new Set<CustomerCaseType>([
    'withdrawal',
    'rejected_customer',
    'onboarding_aborted',
    'supplier_switch_aborted',
    'sales_misunderstanding',
    'dual_invoice_concern',
    'binding_period_too_long',
    'incorrect_identity',
    'incorrect_site_data',
    'missing_authorization',
    'credit_risk',
    'technical_blocker',
    'other',
  ])
  return allowed.has(value as CustomerCaseType) ? (value as CustomerCaseType) : 'other'
}

async function resolveCustomerCompany(customerId: string) {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id, company_id')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  if (!data?.company_id) throw new Error('Kunden saknar bolagskoppling.')
  return String(data.company_id)
}


async function resolveLatestCustomerContractId(customerId: string, companyId: string) {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id')
    .eq('customer_id', customerId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0]?.id ? String(data[0].id) : null
}

async function resolveLatestSwitchRequestId(customerId: string, companyId: string) {
  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('id')
    .eq('customer_id', customerId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0]?.id ? String(data[0].id) : null
}

async function resolveLatestOutboundId(customerId: string, companyId: string) {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('id')
    .eq('customer_id', customerId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0]?.id ? String(data[0].id) : null
}

async function resolveContractDefaults(contractId: string | null) {
  if (!contractId) return null

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id, starts_at, signed_at, created_at, agreement_channel, is_distance_agreement, withdrawal_information_sent_at')
    .eq('id', contractId)
    .maybeSingle()

  if (error) throw error
  return data as {
    starts_at?: string | null
    signed_at?: string | null
    created_at?: string | null
    agreement_channel?: string | null
    is_distance_agreement?: boolean | null
    withdrawal_information_sent_at?: string | null
  } | null
}

async function resolveProdatSentAt(switchRequestId: string | null, outboundRequestId: string | null) {
  if (outboundRequestId) {
    const { data, error } = await supabaseService
      .from('outbound_requests')
      .select('sent_at, prepared_at, queued_at, status')
      .eq('id', outboundRequestId)
      .maybeSingle()
    if (error) throw error
    if (data?.sent_at) return String(data.sent_at)
  }

  if (!switchRequestId) return null

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('sent_at')
    .eq('source_type', 'supplier_switch_request')
    .eq('source_id', switchRequestId)
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0]?.sent_at ? String(data[0].sent_at) : null
}

export async function createCustomerCaseAction(
  _prevState: CustomerCaseActionState,
  formData: FormData
): Promise<CustomerCaseActionState> {
  try {
    const context = await requireAdminActionAccess({ allOf: ['cases.write'] })
    const customerId = text(formData.get('customer_id'))
    if (!customerId) return { ok: false, message: 'Kund saknas.' }

    const companyId = await resolveCustomerCompany(customerId)
    if (!isPlatformAdminContext(context)) {
      await assertUserCanOperateCompany(context.userId, companyId)
    }

    const customerContractId = nullableText(formData.get('customer_contract_id')) ?? await resolveLatestCustomerContractId(customerId, companyId)
    const contractDefaults = await resolveContractDefaults(customerContractId)
    const switchRequestId = nullableText(formData.get('supplier_switch_request_id')) ?? await resolveLatestSwitchRequestId(customerId, companyId)
    const outboundRequestId = nullableText(formData.get('outbound_request_id')) ?? await resolveLatestOutboundId(customerId, companyId)
    const prodatSentAt = await resolveProdatSentAt(switchRequestId, outboundRequestId)
    const caseType = normalizeCaseType(text(formData.get('case_type')))
    const title = text(formData.get('title')) || (caseType === 'withdrawal' ? 'Ånger registrerad' : 'Kundärende')

    const row = await createCustomerCase({
      companyId,
      customerId,
      siteId: nullableText(formData.get('site_id')),
      meteringPointId: nullableText(formData.get('metering_point_id')),
      customerContractId,
      supplierSwitchRequestId: switchRequestId,
      outboundRequestId,
      caseType,
      priority: nullableText(formData.get('priority')) ?? 'normal',
      title,
      description: nullableText(formData.get('description')),
      reasonCategory: nullableText(formData.get('reason_category')),
      agreementChannel: nullableText(formData.get('agreement_channel')) ?? contractDefaults?.agreement_channel ?? null,
      isDistanceAgreement: bool(formData.get('is_distance_agreement')) || Boolean(contractDefaults?.is_distance_agreement),
      agreementCreatedAt: nullableText(formData.get('agreement_created_at')) ?? contractDefaults?.signed_at ?? contractDefaults?.created_at ?? null,
      withdrawalInformationSentAt:
        nullableText(formData.get('withdrawal_information_sent_at')) ?? contractDefaults?.withdrawal_information_sent_at ?? null,
      withdrawalRequestedAt: nullableText(formData.get('withdrawal_requested_at')),
      deliveryStartAt: nullableText(formData.get('delivery_start_at')) ?? contractDefaults?.starts_at ?? null,
      prodatSentAt,
      nextAction: nullableText(formData.get('next_action')),
      assignedTo: nullableText(formData.get('assigned_to')),
      source: 'admin_customer_cases',
      actorUserId: context.userId,
    })

    revalidatePath('/admin/customer-cases')
    revalidatePath(`/admin/customers/${customerId}`)
    revalidatePath('/admin/controltower')
    revalidatePath('/admin/billing/export-center')

    return { ok: true, message: `Ärendet skapades: ${row.title}` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Kundärendet kunde inte skapas.' }
  }
}

export async function updateCustomerCaseStatusAction(
  _prevState: CustomerCaseActionState,
  formData: FormData
): Promise<CustomerCaseActionState> {
  try {
    const context = await requireAdminActionAccess({ allOf: ['cases.write'] })
    const caseId = text(formData.get('case_id'))
    const companyId = text(formData.get('company_id'))
    const customerId = text(formData.get('customer_id'))
    const status = text(formData.get('status'))
    const message = nullableText(formData.get('message'))

    if (!caseId || !companyId || !status) return { ok: false, message: 'Ärende, bolag eller status saknas.' }
    if (!isPlatformAdminContext(context)) await assertUserCanOperateCompany(context.userId, companyId)

    await updateCustomerCaseStatus({
      caseId,
      companyId,
      status,
      message,
      actorUserId: context.userId,
    })

    revalidatePath('/admin/customer-cases')
    if (customerId) revalidatePath(`/admin/customers/${customerId}`)
    return { ok: true, message: 'Ärendet uppdaterades.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Ärendet kunde inte uppdateras.' }
  }
}
