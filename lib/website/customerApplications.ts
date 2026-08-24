import { ensurePostAuthCustomerPortalOnboarding } from '@/lib/customer-portal/postAuthOnboarding'
import { processWebsiteCustomerApplication as processWebsiteCustomerApplicationCore } from './customerApplicationProcess'

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function customerName(rawBody: unknown) {
  const customer = record(record(rawBody).customer)
  const fullName = clean(customer.full_name)
  if (fullName) return fullName
  const combined = [clean(customer.first_name), clean(customer.last_name)].filter(Boolean).join(' ').trim()
  return combined || clean(customer.company_name)
}

/**
 * Public website application entry point.
 *
 * The canonical application core is intentionally allowed to accept checkout
 * before a customer portal identity exists (post_auth_allowed). Once the
 * canonical customer/contract graph is committed we immediately close that
 * loop here by provisioning the Supabase Auth identity, linking Mina sidor and
 * sending the tenant-branded verification/password-setup message.
 */
export async function processWebsiteCustomerApplication(
  input: Parameters<typeof processWebsiteCustomerApplicationCore>[0],
): ReturnType<typeof processWebsiteCustomerApplicationCore> {
  const result = await processWebsiteCustomerApplicationCore(input)
  if (!result.ok) return result

  const data = record(result.body.data)
  if (data.customer_portal_link_pending !== true) return result

  const raw = record(input.rawBody)
  const customer = record(raw.customer)
  const email = clean(customer.email)
  const applicationId = clean(data.application_id)
  const customerId = clean(data.customer_id)
  const customerNumber = clean(data.customer_number)
  const externalCustomerId = clean(data.external_customer_id)

  if (!email || !applicationId || !customerId || !customerNumber || !externalCustomerId) {
    console.error('[website-applications] post-auth portal onboarding missing canonical identifiers', {
      applicationId,
      customerId,
      customerNumber,
      externalCustomerId,
      emailPresent: Boolean(email),
    })
    return {
      ...result,
      body: {
        ...result.body,
        data: {
          ...data,
          customer_portal_activation_pending: true,
          customer_portal_activation_error: 'canonical_identifiers_missing',
        },
      },
    }
  }

  try {
    const activation = await ensurePostAuthCustomerPortalOnboarding({
      companyId: input.client.company_id,
      applicationId,
      customerId,
      customerNumber,
      externalCustomerId,
      customerEmail: email,
      customerName: customerName(input.rawBody),
    })

    return {
      ...result,
      body: {
        ...result.body,
        data: {
          ...data,
          customer_portal_linked: true,
          customer_portal_link_pending: false,
          customer_portal_activation_pending: false,
          customer_portal_activation_status: activation.status,
        },
      },
    }
  } catch (error) {
    console.error('[website-applications] post-auth portal onboarding failed', {
      applicationId,
      customerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      ...result,
      body: {
        ...result.body,
        data: {
          ...data,
          customer_portal_activation_pending: true,
          customer_portal_activation_error: 'post_auth_onboarding_failed',
        },
      },
    }
  }
}

export { continueWebsiteCustomerApplication, repairWebsiteCustomerApplication } from './customerApplicationRepair'
export type { RepairWebsiteCustomerApplicationResult, WebsiteCustomerApplicationContinuationOutcome } from './customerApplicationRepair'
