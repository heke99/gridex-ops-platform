'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import {
  ControlledTestReceiverInputError,
  issueControlledTestReceiverIdentity,
  revokeControlledTestReceiverIdentity,
} from '@/lib/ediel/testing/controlledTestReceiverIdentity'

const PAGE = '/admin/ediel/test-center/receiver-identity'
const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim()

function expectedError(error: unknown): string | null {
  if (error instanceof ControlledTestReceiverInputError) return error.message
  const code = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : ''
  const messages: Record<string, string> = {
    controlled_test_receiver_conflict: 'Test-ID eller bolag har redan en annan identitet. Ingen befintlig identitet ändrades.',
    controlled_test_receiver_expiry_invalid: 'Välj en framtida giltighet på högst 30 dagar.',
    controlled_test_receiver_actor_forbidden: 'Behörighet saknas för att konfigurera denna testidentitet.',
    controlled_test_receiver_company_not_writable: 'Bolaget tillåter inte ändringar av testkonfiguration.',
    controlled_test_receiver_request_conflict: 'Samma kommando-ID har redan använts med andra uppgifter.',
    controlled_test_receiver_registration_mismatch: 'Registreringen matchar inte bolagets oförändrade testidentitet.',
  }
  return messages[code] ?? null
}

function resultRedirect(companyId: string, status: 'success' | 'error', message: string): never {
  redirect(`${PAGE}?${new URLSearchParams({ companyId, runStatus: status, runMessage: message })}`)
}

export async function issueControlledTestReceiverIdentityAction(data: FormData): Promise<never> {
  const context = await requirePlatformAdminActionAccess()
  const companyId = field(data, 'companyId')
  const expiry = field(data, 'expiresAt')
  // The picker is explicitly labelled UTC; its browser value omits an offset.
  const expiresAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expiry) ? `${expiry}:00.000Z` : expiry
  let message: string
  try {
    const result = await issueControlledTestReceiverIdentity(context.userId, {
      companyId, environment: field(data, 'environment'), receiverEdielId: field(data, 'receiverEdielId'),
      role: field(data, 'role'), purpose: field(data, 'purpose'), expiresAt,
      idempotencyKey: field(data, 'idempotencyKey'), acknowledgement: field(data, 'acknowledgement'),
    })
    message = result.status === 'issued' ? 'Lokal TEST-mottagaridentitet utfärdad.' : `Registreringen är ${result.status === 'revoked' ? 'återkallad' : 'utgången'}.`
  } catch (error) {
    const expected = expectedError(error)
    if (!expected) throw error
    resultRedirect(companyId, 'error', expected)
  }
  revalidatePath(PAGE)
  resultRedirect(companyId, 'success', message)
}

export async function revokeControlledTestReceiverIdentityAction(data: FormData): Promise<never> {
  const context = await requirePlatformAdminActionAccess()
  const companyId = field(data, 'companyId')
  try {
    await revokeControlledTestReceiverIdentity(context.userId, {
      companyId, registrationId: field(data, 'registrationId'), reason: field(data, 'reason'),
      idempotencyKey: field(data, 'idempotencyKey'),
    })
  } catch (error) {
    const expected = expectedError(error)
    if (!expected) throw error
    resultRedirect(companyId, 'error', expected)
  }
  revalidatePath(PAGE)
  resultRedirect(companyId, 'success', 'Den lokala TEST-mottagaridentiteten är återkallad.')
}
