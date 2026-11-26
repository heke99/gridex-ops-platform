import 'server-only'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isInvoiceFileGroupSelectionItem, isInvoiceFileSelectionItem, type InvoiceFileIntentScope } from '@/lib/billing/invoiceFileExport'
import { InvoiceProviderConfigError, isFileProvider } from '@/lib/billing/providers/registry'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'

export type SignedInvoiceFileIntent = {
  intentId: string
  companyId: string
  actorUserId: string
  billingMonth: string
  scope: InvoiceFileIntentScope
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function tokenKey(domain = 'gridex-invoice-file-intent-v2') {
  return createHash('sha256').update(`${domain}:${getSupabaseServiceEnv().serviceRoleKey}`).digest()
}

export function signInvoiceFileIntent(intent: SignedInvoiceFileIntent) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv)
  const payload = Buffer.concat([cipher.update(JSON.stringify(intent), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString('base64url')
}

export function readSignedInvoiceFileIntent(token: FormDataEntryValue): SignedInvoiceFileIntent {
  const invalid = () => new InvoiceProviderConfigError('invoice_file_intent_invalid', 'Begäran att skapa fakturafil är ogiltig.')
  if (typeof token !== 'string' || token.length > 512 * 1024) throw invalid()

  let parsed: Partial<SignedInvoiceFileIntent> | null
  try {
    const bytes = Buffer.from(token, 'base64url')
    if (bytes.length < 29 || bytes.toString('base64url') !== token) throw invalid()
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const payload = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
    parsed = JSON.parse(payload.toString('utf8'))
  } catch {
    throw invalid()
  }
  const scope = parsed?.scope
  if (!parsed || typeof parsed.intentId !== 'string' || !UUID_V4.test(parsed.intentId) ||
      typeof parsed.companyId !== 'string' || !parsed.companyId ||
      typeof parsed.actorUserId !== 'string' || !parsed.actorUserId ||
      typeof parsed.billingMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(parsed.billingMonth) ||
      !scope || !isFileProvider(scope.provider) || (scope.environment !== 'test' && scope.environment !== 'production') ||
      !Array.isArray(scope.selection) || scope.selection.length > 1000 || !scope.selection.every(isInvoiceFileSelectionItem) ||
      new Set(scope.selection.map(item => item.itemId.toLowerCase())).size !== scope.selection.length) {
    throw invalid()
  }
  if (scope.groups !== undefined) {
    if (!Array.isArray(scope.groups) || !scope.groups.every(isInvoiceFileGroupSelectionItem)
      || scope.selection.length + scope.groups.length > 1000
      || (scope.groups.length > 0 && scope.provider !== 'file_export')
      || new Set([...scope.selection.map(item => item.itemId.toLowerCase()),
        ...scope.groups.map(group => group.invoiceId.toLowerCase())]).size !== scope.selection.length + scope.groups.length) throw invalid()
  }
  return parsed as SignedInvoiceFileIntent
}


type InvoiceFileMonthLockScope = { companyId: string; actorUserId: string; billingMonth: string; fileId: string }

function invoiceFileMonthLockMac(scope: InvoiceFileMonthLockScope) {
  return createHmac('sha256', tokenKey('gridex-invoice-file-month-lock-notice-v1'))
    .update(JSON.stringify([scope.companyId, scope.actorUserId, scope.billingMonth, scope.fileId, 'failed']))
    .digest()
}

/** An action observation for the receipt display. Durable lock status lives in the database. */
export function signInvoiceFileMonthLockNotice(scope: InvoiceFileMonthLockScope) {
  return `failed.${invoiceFileMonthLockMac(scope).toString('base64url')}`
}

export function readInvoiceFileMonthLockNotice(scope: InvoiceFileMonthLockScope, token: unknown) {
  if (typeof token !== 'string' || !/^failed\.[A-Za-z0-9_-]{43}$/.test(token)) return false
  const signature = token.slice('failed.'.length)
  const provided = Buffer.from(signature, 'base64url')
  return provided.length === 32 && provided.toString('base64url') === signature &&
    timingSafeEqual(provided, invoiceFileMonthLockMac(scope))
}
