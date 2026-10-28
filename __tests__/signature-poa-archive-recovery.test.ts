import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, archives: [] as Row[], completions: [] as Row[], failArchive:false, failCompletion:false }))
function query(table:string) {
  const filters:Array<(r:Row)=>boolean>=[]; let single=false; let patch:Row|null=null
  const q={ select:()=>q, eq:(key:string,value:unknown)=>{filters.push(r=>key.includes('->>')?String((r[key.split('->>')[0]] as Row)?.[key.split('->>')[1]])===value:r[key]===value);return q},
    update:(v:Row)=>{patch=v;return q},order:()=>q,limit:()=>q,
    maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},
    then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>{
      const rows=(io.tables[table]??[]).filter(r=>filters.every(f=>f(r)))
      if(patch)rows.forEach(r=>Object.assign(r,patch))
      return Promise.resolve({data:single?(rows[0]?{...rows[0]}:null):rows.map(r=>({...r})),error:null}).then(resolve,reject)
    }};return q
}
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(t:string)=>query(t),rpc:async(name:string,args:Row)=>{
  if(name!=='gridex_complete_online_signature_poa_archive_v1')throw Error('unexpected RPC')
  io.completions.push(args)
  return {data:{power_of_attorney_id:'poa-a'},error:io.failCompletion?Error('completion unavailable'):null}
}}}))
vi.mock('@/lib/ediel/retention/customerRecordClasses',()=>({requireContractRecordsAvailable:async()=>undefined}))
vi.mock('@/lib/customers/poaDocuments',()=>({ensurePoaPdfArchive:async(scope:Row)=>{
  io.archives.push(scope);if(io.failArchive)throw Error('archive unavailable')
  const pdf=Buffer.from('%PDF-1.7 synthetic fixture bytes')
  const sha=createHash('sha256').update(pdf).digest('hex')
  const poa=io.tables.powers_of_attorney[0]
  const path=`companies/company-a/customers/customer-a/powers-of-attorney/poa-a/fullmakt-${sha}.pdf`
  poa.document_path=path;poa.metadata={...(poa.metadata as Row),document_archive:{path,storage_bucket:'customer-documents',sha256:sha,evidence_sha256:poaMailEvidenceFingerprint(poa)}}
  return {path,pdf}
}}))
import { archiveOnlineSignaturePoa, recoverPendingOnlineSignaturePoas, loadOnlineSignaturePoaTerms } from '@/lib/customer-contracts/onlineSigning'
import { hasExternallySendablePoa } from '@/lib/customers/poaReadiness'
import { poaMailEvidenceFingerprint,poaMailEvidenceIssues } from '@/lib/email/poaMailEvidence'
const signedAt='2026-10-28T10:00:00.000Z'
const receipt={company_id:'company-a',customer_id:'customer-a',contract_id:'contract-a',request_id:'request-a',signed_at:signedAt,signature_snapshot_sha256:'sig-original'}
const poa=()=>io.tables.powers_of_attorney[0]
beforeEach(()=>{
  io.archives=[];io.completions=[];io.failArchive=false;io.failCompletion=false
  io.tables={
    customer_contracts:[{id:'contract-a',company_id:'company-a',customer_id:'customer-a',signed_at:signedAt,signature_snapshot_sha256:'sig-original',
      contract_product_version_id:'product-a',contract_publication_version_id:'publication-a',customer_site_id:'site-a',site_id:'site-a',signature_snapshot:{schema:'gridex_online_contract_signature_v2',power_of_attorney_snapshot:{power_of_attorney_id:'poa-a'},signature_request_id:'request-a'}}],
    contract_product_versions:[{id:'product-a',power_of_attorney_required:true}],
    customer_sites:[{id:'site-a',company_id:'company-a',customer_id:'customer-a',street:'Synthetic street',postal_code:'12345',city:'Synthetic town'}],
    customer_operation_jobs:[{company_id:'company-a',customer_id:'customer-a',idempotency_key:'contract-signed:contract-a',job_type:'start_supplier_switch',status:'blocked',review_reason_code:'poa_archive_pending',payload:{online_poa_id:'poa-a',signature_request_id:'request-a'}}],
    powers_of_attorney:[{id:'poa-a',company_id:'company-a',customer_id:'customer-a',customer_contract_id:'contract-a',source:'ops_online_signature',status:'signed',accepted_at:signedAt,signed_at:signedAt,
      signer_name:'Synthetic signer',signer_identity_number:'synthetic-identity',method:'secure_link_click',signed_scope_snapshot:['supplier_switch','facility_information_lookup'],
      fullmakt_snapshot:{legal_text:{body:'Original synthetic text'}},updated_at:'2026-10-28T10:00:01Z',
      evidence_payload:{signature_request_id:'request-a',signature_snapshot_sha256:'sig-original',capture_type:'structured_complete',capture_source:'actual_signing_request',ip_address:'192.0.2.8',ip_address_source:'signer_reported',verification_reference:'original-verifier'},
      metadata:{online_signature_archive_pending:true,signature_request_id:'request-a'}}],
  }
})
describe('online POA private archive continuation',()=>{
  it('archives original proof and completes only the exact tenant/customer/contract/request/POA',async()=>{
    const evidence=structuredClone(poa().evidence_payload)
    const attachment=await archiveOnlineSignaturePoa(receipt)
    expect(io.archives).toEqual([{companyId:'company-a',customerId:'customer-a',powerOfAttorneyId:'poa-a'}])
    expect(io.completions).toHaveLength(1)
    expect(io.completions[0]).toMatchObject({p_company_id:'company-a',p_customer_id:'customer-a',p_contract_id:'contract-a',p_request_id:'request-a',p_poa_id:'poa-a'})
    expect(io.completions[0].p_sha256).toBe(createHash('sha256').update(Buffer.from(attachment!.content,'base64')).digest('hex'))
    expect(poa().evidence_payload).toEqual(evidence)
  })
  it.each(['company_id','customer_id','customer_contract_id'])('does not archive a POA with foreign %s',async key=>{
    poa()[key]='foreign';await expect(archiveOnlineSignaturePoa(receipt)).rejects.toThrow(/poa_/)
    expect(io.archives).toHaveLength(0);expect(io.completions).toHaveLength(0)
  })
  it('cannot create original signer IP from a retry request',async()=>{
    (poa().evidence_payload as Row).ip_address=null
    await expect(archiveOnlineSignaturePoa(receipt)).rejects.toThrow(/poa_/)
    expect(io.archives).toHaveLength(0);expect(io.completions).toHaveLength(0)
  })
  it('retains the durable hold when archive fails; a later recovery uses unchanged original evidence',async()=>{
    io.failArchive=true;const before=structuredClone(poa().evidence_payload)
    const first=await recoverPendingOnlineSignaturePoas()
    expect(first.results[0].state).toBe('pending');expect(io.completions).toHaveLength(0)
    expect(io.tables.customer_operation_jobs[0].last_error).toMatch(/Automatiken är spärrad/)
    expect((poa().metadata as Row).online_signature_archive_pending).toBe(true)
    io.failArchive=false
    const second=await recoverPendingOnlineSignaturePoas()
    expect(second.results[0].state).toBe('archived');expect(io.completions).toHaveLength(1)
    expect(poa().evidence_payload).toEqual(before)
  })
  it('never reports completion when the atomic completion RPC fails',async()=>{
    io.failCompletion=true;await expect(archiveOnlineSignaturePoa(receipt)).rejects.toThrow('completion unavailable')
    expect((poa().metadata as Row).online_signature_archive_pending).toBe(true)
  })
  it('does not backfill a legacy signature without original POA/IP',async()=>{
    (io.tables.customer_contracts[0].signature_snapshot as Row).power_of_attorney_snapshot={}
    expect(await archiveOnlineSignaturePoa(receipt)).toBeNull();expect(io.archives).toHaveLength(0)
  })
  it('keeps the accurate new source blocked before verified archive and for missing signer IP',async()=>{
    expect(hasExternallySendablePoa(poa())).toBe(false)
    expect(poaMailEvidenceIssues(poa()).map(i=>i.code)).toContain('poa_private_archive_pending')
    await archiveOnlineSignaturePoa(receipt)
    poa().document_id='doc-a';poa().metadata={...(poa().metadata as Row),online_signature_archive_pending:false}
    expect(hasExternallySendablePoa(poa())).toBe(true);
    (poa().evidence_payload as Row).ip_address=null
    expect(hasExternallySendablePoa(poa())).toBe(false)
    expect(poaMailEvidenceIssues(poa()).map(i=>i.code)).toContain('poa_signer_ip_missing')
  })
})

describe('signing POA page uses only the contract exact site alias',()=>{
  const termsReceipt={...receipt,contract_publication_version_id:'publication-a',legal_versions:[{module_key:'power_of_attorney'}]}
  it('supports a verified known legacy site without changing the original contract',async()=>{
    io.tables.customer_contracts[0].customer_site_id=null
    const before=structuredClone(io.tables.customer_contracts)
    expect(await loadOnlineSignaturePoaTerms(termsReceipt)).toMatchObject({available:true,required:true,siteAddress:'Synthetic street, 12345, Synthetic town'})
    expect(io.tables.customer_contracts).toEqual(before)
  })
  it('rejects contradictory site aliases',async()=>{
    io.tables.customer_contracts[0].site_id='site-b'
    await expect(loadOnlineSignaturePoaTerms(termsReceipt)).rejects.toThrow('poa_site_scope_ambiguous')
  })
  it('never infers the customer only site if neither alias is recorded',async()=>{
    io.tables.customer_contracts[0].site_id=null;io.tables.customer_contracts[0].customer_site_id=null
    expect(await loadOnlineSignaturePoaTerms(termsReceipt)).toMatchObject({available:false,siteAddress:''})
  })
})
