import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { prepareSupportAttachmentScan } from './attachmentScan'
import { scannerTrustEntry, verifySupportAttachmentScannerProof } from './scannerProof'
import { configuredAttachmentScannerAdapter, readSupportAttachmentPhysicalBytes, scanCallbackSchema, type AttachmentScannerAdapter } from './attachmentScannerAdapter'
const claimSchema = z.object({scanIntentId:z.string().uuid(),companyId:z.string().uuid(),attachmentId:z.string().uuid(),claimToken:z.string().uuid()}).strict()
const resultSchema = z.object({nonceId:z.string().uuid(),attachmentId:z.string().uuid(),verdict:z.enum(['clean','malicious','unknown']),
  outcome:z.literal('blocked_scanner_qualification'),releaseAllowed:z.literal(false),replayed:z.boolean()}).strict()
const configuration=()=>process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST
const unavailable=()=>new Error('support_attachment_scan_unavailable')

export async function receiveSupportAttachmentScannerCallback(input: {nonceId:string;token:string}) {
  const parsed=z.object({nonceId:z.string().uuid(),token:z.string().min(1).max(8192)}).strict().safeParse(input)
  if(!parsed.success)throw unavailable()
  const response=await supabaseService.rpc('gridex_get_support_attachment_scan_callback_v1',{p_nonce_id:parsed.data.nonceId})
  const authoritative=scanCallbackSchema.safeParse(response.data)
  if(response.error||!authoritative.success||authoritative.data.challenge.nonceId!==parsed.data.nonceId)throw unavailable()
  const challenge=authoritative.data.challenge
  const first=await verifySupportAttachmentScannerProof({token:parsed.data.token,challenge,configuration:configuration()})
  if(!first)throw unavailable()
  const physical=await readSupportAttachmentPhysicalBytes(challenge)
  const proof=await verifySupportAttachmentScannerProof({token:parsed.data.token,challenge,configuration:configuration()})
  if(!proof)throw unavailable()
  const committed=await supabaseService.rpc('gridex_commit_support_attachment_scan_callback_v1',{
    p_nonce_id:challenge.nonceId,p_claim_token:authoritative.data.claimToken,
    p_proof:{...proof,physicalSha256:physical.witness.sha256,physicalByteSize:physical.witness.byteSize},
  })
  const result=resultSchema.safeParse(committed.data)
  if(committed.error||!result.success||result.data.nonceId!==challenge.nonceId||result.data.attachmentId!==challenge.attachmentId
    ||result.data.verdict!==proof.verdict)throw unavailable()
  return result.data
}

export async function processSupportAttachmentScans(input: {companyId?:string|null;limit?:number;claimToken?:string},
  adapter:AttachmentScannerAdapter|null=configuredAttachmentScannerAdapter()) {
  const parsed=z.object({companyId:z.string().uuid().nullable().optional(),limit:z.number().int().min(1).max(20).default(10),
    claimToken:z.string().uuid().default(randomUUID())}).strict().safeParse(input)
  if(!parsed.success)throw unavailable()
  const response=await supabaseService.rpc('gridex_claim_support_attachment_scans_v1',{
    p_company_id:parsed.data.companyId??null,p_limit:parsed.data.limit,p_claim_token:parsed.data.claimToken,
  })
  const claims=z.array(claimSchema).max(parsed.data.limit).safeParse(response.data)
  if(response.error||!claims.success||claims.data.some(row=>row.claimToken!==parsed.data.claimToken||
    (parsed.data.companyId&&row.companyId!==parsed.data.companyId)))throw unavailable()
  const result={claimed:claims.data.length,blocked:0,evidenceRecorded:0,awaitingCallback:0,needsReview:0,errors:0}
  for(const claim of claims.data){
    const finish=async(outcome:'blocked_scanner_qualification'|'needs_review')=>{
      const completed=await supabaseService.rpc('gridex_finish_support_attachment_scan_claim_v1',{
        p_intent_id:claim.scanIntentId,p_claim_token:claim.claimToken,p_outcome:outcome,
      })
      if(completed.error||completed.data!==true)throw unavailable()
    }
    try{
      if(!adapter){await finish('blocked_scanner_qualification');result.blocked++;continue}
      if(adapter.evidencePurpose!=='gridex_support_attachment_scan_v1')throw unavailable()
      const challenge=await prepareSupportAttachmentScan({companyId:claim.companyId,attachmentId:claim.attachmentId})
      if(challenge.scanIntentId!==claim.scanIntentId)throw unavailable()
      const bound=await supabaseService.rpc('gridex_bind_support_attachment_scan_claim_v1',{
        p_intent_id:claim.scanIntentId,p_claim_token:claim.claimToken,p_nonce_id:challenge.nonceId,
      })
      if(bound.error||bound.data!==true)throw unavailable()
      const physical=await readSupportAttachmentPhysicalBytes(challenge)
      const current=await supabaseService.rpc('gridex_get_support_attachment_scan_callback_v1',{p_nonce_id:challenge.nonceId})
      const checked=scanCallbackSchema.safeParse(current.data),trust=await scannerTrustEntry(claim.companyId,configuration())
      if(current.error||!checked.success||JSON.stringify(checked.data.challenge)!==JSON.stringify(challenge)
        ||checked.data.claimToken!==claim.claimToken||!trust||Object.entries(trust.trust).some(([key,value])=>
          challenge[key as keyof typeof trust.trust]!==value)||challenge.expiresAt<=Math.floor(Date.now()/1000))throw unavailable()
      const evidence=await adapter.issue({challenge,bytes:physical.bytes})
      if('token'in evidence){await receiveSupportAttachmentScannerCallback({nonceId:challenge.nonceId,token:evidence.token});result.evidenceRecorded++}
      else if(evidence.awaitingCallback===true){result.awaitingCallback++}
      else throw unavailable()
    }catch{
      result.errors++
      try{await finish('needs_review');result.needsReview++}catch{ /* Stale claims cannot replace a newer result; bounded SQL recovery owns them. */ }
    }
  }
  return result
}
