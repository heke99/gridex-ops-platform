import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { isGridOwnerAgreementBucket, parseGridOwnerAgreementDocumentKey } from './gridOwnerAgreementDocumentKey'

export const agreementCleanupInput = z.object({ companyId: z.string().uuid().nullable(), limit: z.number().int().min(1).max(10).default(5) }).strict()
const receiptSchema = z.object({
  uploadIntentId: z.string().uuid(), companyId: z.string().uuid().nullable(), actorUserId: z.string().uuid(),
  claimToken: z.string().uuid(), attempt: z.number().int().positive().safe(), bucket: z.string(), path: z.string(),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/), leaseExpiresAt: z.number().int().positive().safe(),
}).strict()
const completionSchema = z.object({ finished: z.literal(true), replayed: z.boolean() }).strict()
const unavailable = () => new Error('agreement_cleanup_unavailable')
type Storage = { from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: unknown }> } }

/** One explicit company (NULL means global rows), with no all-tenant sweep.
 * The DB seals never-attached keys; periodic settlement remains necessary for
 * an old in-flight upload completing after a previous remove acknowledgement. */
export async function processAgreementCleanup(input: unknown, storage: Storage = supabaseService.storage) {
  const parsed = agreementCleanupInput.safeParse(input)
  if (!parsed.success) throw new Error('invalid_agreement_cleanup')
  const token = randomUUID()
  const response = await supabaseService.rpc('gridex_claim_agreement_cleanup_v1', {
    p_company_id: parsed.data.companyId, p_claim_token: token, p_limit: parsed.data.limit,
  })
  const receipts = z.array(receiptSchema).max(parsed.data.limit).safeParse(response.data)
  if (response.error || !receipts.success || receipts.data.some(receipt =>
    receipt.companyId !== parsed.data.companyId || receipt.claimToken !== token ||
    receipt.leaseExpiresAt <= Math.floor(Date.now() / 1000) || receipt.bucket === 'customer-support-quarantine' ||
    !isGridOwnerAgreementBucket(receipt.bucket) || !parseGridOwnerAgreementDocumentKey(receipt.path, receipt.bucket) ||
    parseGridOwnerAgreementDocumentKey(receipt.path, receipt.bucket)?.path !== receipt.path ||
    parseGridOwnerAgreementDocumentKey(receipt.path, receipt.bucket)?.bucket !== receipt.bucket) ||
    new Set(receipts.data.map(row => row.uploadIntentId)).size !== receipts.data.length ||
    new Set(receipts.data.map(row => row.bucket + ':' + row.path)).size !== receipts.data.length) throw unavailable()
  const result = { claimed: receipts.data.length, removed: 0, retried: 0, stale: 0, errors: 0 }
  for (const receipt of receipts.data) {
    try {
      // Revalidate the exact lease, sealed key, current bucket and actual
      // registered/committed references immediately before the physical call.
      const current = await supabaseService.rpc('gridex_validate_agreement_cleanup_v1', { p_receipt: receipt })
      if (current.error) throw unavailable()
      if (current.data !== true) { result.stale++; continue }
      let outcome: 'removed' | 'retry' = 'retry'
      try {
        const removed = await storage.from(receipt.bucket).remove([receipt.path])
        if (!removed.error) outcome = 'removed'
      } catch { /* Unknown/remove failures remain durable retry, never success. */ }
      const completed = await supabaseService.rpc('gridex_finish_agreement_cleanup_v1', { p_receipt: receipt, p_outcome: outcome })
      if (completed.error || !completionSchema.safeParse(completed.data).success) throw unavailable()
      if (outcome === 'removed') result.removed++; else result.retried++
    } catch { result.errors++ /* No raw paths, capabilities or provider errors are surfaced. */ }
  }
  return result
}
