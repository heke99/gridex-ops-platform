import 'server-only'
import { supabaseService } from '@/lib/supabase/service'
import { scannerSha256, supportScanChallengeSchema, supportScanLineageSchema, type SupportScanChallenge } from './scannerProof'
import { z } from 'zod'

/** A configured integration may submit evidence; this interface cannot qualify
 * a malware provider or authorize release. Production currently has no adapter. */
export type AttachmentScannerAdapter = {
  evidencePurpose: 'gridex_support_attachment_scan_v1'
  issue: (input: { challenge: SupportScanChallenge; bytes: Uint8Array }) => Promise<{ token: string } | { awaitingCallback: true }>
}
export function configuredAttachmentScannerAdapter(): AttachmentScannerAdapter | null { return null }
export const scanCallbackSchema = z.object({ challenge: supportScanChallengeSchema,scanIntentId: z.string().uuid(),
  claimToken: z.string().uuid().nullable(),status: z.enum(['processing','evidence_recorded']) }).strict()

/** Internal bytes never become a download response or a public URL. */
export async function readSupportAttachmentPhysicalBytes(binding: z.infer<typeof supportScanLineageSchema>) {
  if (binding.bucket !== 'customer-support-quarantine' || binding.objectKey !==
    `${binding.companyId}/${binding.customerId}/${binding.caseId}/${binding.attachmentId}`) throw new Error('support_attachment_scan_unavailable')
  const response = await supabaseService.storage.from(binding.bucket).download(binding.objectKey)
  if (response.error || !response.data || response.data.size !== binding.byteSize) throw new Error('support_attachment_scan_unavailable')
  const bytes = new Uint8Array(await response.data.arrayBuffer())
  if (bytes.byteLength !== binding.byteSize || scannerSha256(bytes) !== binding.sha256) throw new Error('support_attachment_scan_unavailable')
  return { bytes,witness: { objectId: binding.objectId,objectVersion: binding.objectVersion,objectUpdatedAt: binding.objectUpdatedAt,
    sha256: scannerSha256(bytes),byteSize: bytes.byteLength } }
}
