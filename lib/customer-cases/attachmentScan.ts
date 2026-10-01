import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { supportActorContext, type SupportReadContext } from './customerRead'
import { scannerSha256, scannerTrustEntry, supportScanChallengeSchema, supportScanLineageSchema,
  verifySupportAttachmentScannerProof, type SupportScanChallenge } from './scannerProof'

const configuration = () => process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST
const unavailable = () => new Error('support_attachment_scan_unavailable')
const readContextSchema = z.object({ companyId: z.string().uuid(),customerId: z.string().uuid(),actor: z.union([
  z.object({ kind: z.enum(['ops','portal']),userId: z.string().uuid(),sessionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('api'),clientId: z.string().uuid(),subject: z.string().min(1).max(255) }).strict(),
]) }).strict()
const receiptSchema = z.object({ nonceId: z.string().uuid(),attachmentId: z.string().uuid(),
  verdict: z.enum(['clean','malicious','unknown']),outcome: z.literal('blocked_provider_qualification'),
  releaseAllowed: z.literal(false),replayed: z.boolean() }).strict()
const assessmentSchema = z.object({ binding: supportScanLineageSchema,verdict: z.enum(['clean','malicious','unknown']).nullable(),
  releaseAllowed: z.literal(false),quarantine: z.literal('quarantined'),physicalHashVerified: z.boolean(),
  outcome: z.enum(['blocked_unscanned','blocked_scan_verdict','blocked_provider_qualification']) }).strict()

async function physicalWitness(binding: z.infer<typeof supportScanLineageSchema>) {
  if (binding.objectKey !== `${binding.companyId}/${binding.customerId}/${binding.caseId}/${binding.attachmentId}`) throw unavailable()
  const stored = await supabaseService.storage.from(binding.bucket).download(binding.objectKey)
  if (stored.error || !stored.data || stored.data.size !== binding.byteSize) throw unavailable()
  const bytes = new Uint8Array(await stored.data.arrayBuffer())
  if (bytes.byteLength !== binding.byteSize || scannerSha256(bytes) !== binding.sha256) throw unavailable()
  return { objectId: binding.objectId,objectVersion: binding.objectVersion,objectUpdatedAt: binding.objectUpdatedAt,
    sha256: scannerSha256(bytes),byteSize: bytes.byteLength }
}

/** Prepares internal evidence for the exact durable intake. No scanner is
 * called, no bytes are handed to a caller, and no quarantine state is changed. */
export async function prepareSupportAttachmentScan(input: { companyId: string; attachmentId: string }) {
  if (!z.object({ companyId: z.string().uuid(),attachmentId: z.string().uuid() }).strict().safeParse(input).success) throw unavailable()
  const entry = await scannerTrustEntry(input.companyId,configuration())
  if (!entry) throw unavailable()
  const response = await supabaseService.rpc('gridex_reserve_support_attachment_scan_v1', {
    p_company_id: input.companyId,p_attachment_id: input.attachmentId,p_trust: entry.trust,
  })
  if (response.error) throw unavailable()
  const parsed = supportScanChallengeSchema.safeParse(response.data)
  if (!parsed.success || parsed.data.companyId !== input.companyId || parsed.data.attachmentId !== input.attachmentId
    || Object.entries(entry.trust).some(([key,value]) => parsed.data[key as keyof typeof entry.trust] !== value)) throw unavailable()
  await physicalWitness(parsed.data)
  const current = await scannerTrustEntry(input.companyId,configuration())
  if (!current || Object.entries(current.trust).some(([key,value]) => parsed.data[key as keyof typeof current.trust] !== value)
    || parsed.data.issuedAt>Math.floor(Date.now()/1000) || parsed.data.expiresAt<=Math.floor(Date.now()/1000)
    || parsed.data.expiresAt-parsed.data.issuedAt>300) throw unavailable()
  return parsed.data
}

/** Authenticated signed evidence is private. A clean claim alone cannot release
 * a file or qualify the malware detection provider/protected download path. */
export async function recordSupportAttachmentScannerVerdict(input: { challenge: SupportScanChallenge; token: string | null }) {
  const candidate = z.object({ challenge: supportScanChallengeSchema,token: z.string().max(8192).nullable() }).strict().safeParse(input)
  if (!candidate.success) throw unavailable()
  const firstProof = await verifySupportAttachmentScannerProof({ ...candidate.data,configuration: configuration() })
  if (!firstProof) throw unavailable()
  const witness = await physicalWitness(candidate.data.challenge)
  const proof = await verifySupportAttachmentScannerProof({ ...candidate.data,configuration: configuration() })
  if (!proof) throw unavailable()
  const response = await supabaseService.rpc('gridex_record_support_attachment_scan_v1', {
    p_nonce_id: candidate.data.challenge.nonceId,p_proof: { ...proof,physicalSha256: witness.sha256,physicalByteSize: witness.byteSize },
  })
  if (response.error) throw unavailable()
  const parsed = receiptSchema.safeParse(response.data)
  if (!parsed.success || parsed.data.nonceId !== candidate.data.challenge.nonceId || parsed.data.attachmentId !== candidate.data.challenge.attachmentId
    || parsed.data.verdict !== proof.verdict) throw unavailable()
  return parsed.data
}

/** This is a current-authority blocked eligibility decision, not a download.
 * Recheck authority/root/object after private byte inspection. Every result
 * still says releaseAllowed=false; public attachment contracts stay quarantined. */
export async function assessSupportAttachmentScan(context: SupportReadContext, attachmentId: string) {
  const scoped = readContextSchema.safeParse(context)
  if (!scoped.success || !z.string().uuid().safeParse(attachmentId).success) throw unavailable()
  const entry = await scannerTrustEntry(scoped.data.companyId,configuration())
  if (!entry) throw unavailable()
  const assess = async (witness: Awaited<ReturnType<typeof physicalWitness>> | null) => {
    const response = await supabaseService.rpc('gridex_assess_support_attachment_scan_v1', {
      p_context: supportActorContext(scoped.data),p_attachment_id: attachmentId,p_trust: entry.trust,p_witness: witness,
    })
    if (response.error) throw unavailable()
    const parsed = assessmentSchema.safeParse(response.data)
    if (!parsed.success || parsed.data.binding.companyId !== scoped.data.companyId || parsed.data.binding.customerId !== scoped.data.customerId
      || parsed.data.binding.attachmentId !== attachmentId || parsed.data.physicalHashVerified !== Boolean(witness)) throw unavailable()
    const expectedOutcome = !parsed.data.verdict ? 'blocked_unscanned' : parsed.data.verdict === 'clean'
      ? 'blocked_provider_qualification' : 'blocked_scan_verdict'
    if (parsed.data.outcome !== expectedOutcome) throw unavailable()
    return parsed.data
  }
  const first = await assess(null),witness = await physicalWitness(first.binding)
  const current = await scannerTrustEntry(scoped.data.companyId,configuration())
  if (!current || Object.entries(current.trust).some(([key,value]) => entry.trust[key as keyof typeof entry.trust] !== value)) throw unavailable()
  const final = await assess(witness)
  if (JSON.stringify(first.binding) !== JSON.stringify(final.binding) || first.verdict !== final.verdict) throw unavailable()
  return { releaseAllowed: false as const,quarantine: final.quarantine,outcome: final.outcome,verdict: final.verdict,
    physicalHashVerified: true as const }
}
