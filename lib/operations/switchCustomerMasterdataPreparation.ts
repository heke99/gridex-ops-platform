import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

/**
 * FINDINGS F51 (owner decisions 2026-10-22): a Z03 whose start day is not today reads the end
 * user's identity and registered address only from an approved customer masterdata declaration.
 * The native owner (ediel_derive_contract_customer_masterdata_v1) derives it from the signed
 * contract: the signed snapshot's customer masterdata section whose lines are in the archived
 * signed PDF, or — for manual intake and imported PDFs — the staff member's registered address
 * entry. A later registered address supersedes it from the change day; history is kept.
 */
export type ContractCustomerMasterdataDerivation =
  | { status: 'derived' | 'superseded' | 'unchanged'; declarationId: string | null; reason?: string }
  | { status: 'held'; missing: string[] }

type Scope = { companyId: string; contractId: string; actorUserId: string; environment: 'test' | 'production' }

/** The archived signed agreement bytes, only when they hash to the contract's document_sha256. */
async function verifiedSignedAgreement(input: Pick<Scope, 'companyId' | 'contractId'>): Promise<Buffer | null> {
  const contract = await supabaseService.from('customer_contracts').select('id,document_sha256')
    .eq('company_id', input.companyId).eq('id', input.contractId).maybeSingle()
  if (contract.error) throw contract.error
  const hash = contract.data?.document_sha256
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return null
  const document = await supabaseService.from('customer_contract_documents').select('storage_bucket,storage_path')
    .eq('company_id', input.companyId).eq('customer_contract_id', input.contractId).eq('document_type', 'signed_contract_pdf').eq('document_sha256', hash)
    .not('verified_at', 'is', null).limit(1).maybeSingle()
  if (document.error) throw document.error
  if (!document.data?.storage_bucket || !document.data.storage_path) return null
  const download = await supabaseService.storage.from(document.data.storage_bucket).download(document.data.storage_path)
  if (download.error || !download.data) return null
  const bytes = Buffer.from(await download.data.arrayBuffer())
  return createHash('sha256').update(bytes).digest('hex') === hash ? bytes : null
}

function checkedResult(data: unknown): ContractCustomerMasterdataDerivation {
  const value = data as Record<string, unknown> | null
  if (value?.status === 'held' && Array.isArray(value.missing) && value.missing.length > 0 && value.missing.every(item => typeof item === 'string' && item.length > 0)) {
    return { status: 'held', missing: value.missing as string[] }
  }
  if (value && (value.status === 'derived' || value.status === 'superseded' || value.status === 'unchanged')) {
    const declarationId = typeof value.declarationId === 'string' ? value.declarationId : null
    if (value.status !== 'unchanged' && !declarationId) throw Error('contract_customer_masterdata_result_invalid')
    return { status: value.status, declarationId, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) }
  }
  throw Error('contract_customer_masterdata_result_invalid')
}

/** Derives (or supersedes) the contract's customer masterdata declaration for one Ediel lane. Idempotent. */
export async function deriveContractCustomerMasterdata(input: Scope): Promise<ContractCustomerMasterdataDerivation> {
  const bytes = await verifiedSignedAgreement(input)
  if (!bytes) return { status: 'held', missing: ['archived_verified_signed_agreement_original'] }
  const { data, error } = await supabaseService.rpc('ediel_derive_contract_customer_masterdata_v1', {
    p_company_id: input.companyId, p_contract_id: input.contractId, p_actor_user_id: input.actorUserId,
    p_environment: input.environment, p_agreement_original: `\\x${bytes.toString('hex')}`,
  })
  if (error) throw error
  return checkedResult(data)
}

/**
 * Runs before a Z03 is prepared, next to the requested-method derivation. The Ediel environment is
 * chosen later by route resolution, so both lanes are offered. Never blocks: a declaration that
 * cannot be derived leaves the masterdata source held with its reason.
 */
export async function deriveCustomerMasterdataBeforeSwitch(input: { actorUserId: string; switchRequestId: string }) {
  const { data, error } = await supabaseService.from('supplier_switch_requests')
    .select('id,company_id,customer_contract_id,contract_id').eq('id', input.switchRequestId).maybeSingle()
    .then(result => result, failure => ({ data: null, error: failure as Error }))
  if (error || !data?.company_id) return
  const contractId = (data.customer_contract_id ?? data.contract_id) as string | null
  if (!contractId) return
  for (const environment of ['production', 'test'] as const) {
    const result = await deriveContractCustomerMasterdata({ companyId: data.company_id as string, contractId, actorUserId: input.actorUserId, environment })
      .catch(failure => { console.warn('[switch] customer masterdata derivation skipped', { switchRequestId: input.switchRequestId, environment, failure }); return null })
    if (result?.status === 'held') console.warn('[switch] customer masterdata declaration held', { switchRequestId: input.switchRequestId, environment, missing: result.missing })
  }
}
