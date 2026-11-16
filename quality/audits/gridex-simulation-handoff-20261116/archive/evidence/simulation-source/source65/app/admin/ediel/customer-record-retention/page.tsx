import { z } from 'zod'
import { requireRetentionScope } from '@/lib/ediel/retention/retentionHttp'
import { CUSTOMER_RECORD_RETENTION_CLASSES } from '@/lib/ediel/retention/recordClasses.catalog'
import Workspace,{type RetentionChoice} from './workspace'
export const dynamic='force-dynamic'
const labels:Record<string,string>={contract_signed_pdf_bytes:'Signerad avtalsfil',contract_signature_personal_snapshot:'Avtalets personliga signaturuppgifter',contract_signature_request_personal:'Signeringsbegärans personuppgifter',contract_acceptance_personal_snapshot:'Avtalsacceptansens personuppgifter',contract_evidence_personal_snapshot:'Avtalsbevisets personuppgifter',customer_address_history:'Historisk inaktiv kundadress',portal_event_history:'Portalhändelsens personuppgifter',portal_access_log_history:'Portalåtkomstens personuppgifter',portal_customer_event_history:'Kundhändelsens personuppgifter',portal_domain_event_history:'Processhändelsens personuppgifter',legal_acceptance_personal_snapshot:'Juridisk acceptans – personuppgifter',onboarding_legal_personal_snapshot:'Registreringens juridiska personuppgifter'}
const grant=(k:string)=>k==='contract_signed_pdf_bytes'?'ediel.retention.contract_pdf':k.startsWith('contract_')?'ediel.retention.signature':k==='customer_address_history'?'ediel.retention.address_history':k.startsWith('portal_')?'ediel.retention.portal_history':'ediel.retention.legal_history'
export default async function CustomerRecordRetentionPage(){
 try{
  const scope=await requireRetentionScope(),choices:RetentionChoice[]=[]
  for(const retentionClass of CUSTOMER_RECORD_RETENTION_CLASSES){
   if(!scope.permissions.includes(grant(retentionClass)))continue
   const reply=await scope.client.rpc('ediel_customer_record_retention_targets_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.userId,p_retention_class:retentionClass,p_limit:100})
   if(reply.error)throw reply.error
   choices.push({retentionClass,label:labels[retentionClass],targets:z.array(z.object({targetId:z.string().uuid(),recordedAt:z.string().nullable(),tombstoned:z.boolean()})).parse(reply.data)})
  }
  return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="text-2xl font-semibold">Klassbunden gallring</h1><p className="my-4">Varje exakt källpost har ett separat beslut. Avtalsfil, signatur, adress, portalhistorik och juridisk journal har olika ingrepp; inga tidsgränser förutsätts.</p><Workspace choices={choices} canSubmit={scope.permissions.includes('ediel.retention.submit')} canRead={scope.permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review')} canReview={scope.permissions.includes('ediel.retention.review')} canPurge={scope.permissions.includes('ediel.retention.purge')}/></main>
 }catch{return <main className="p-6"><h1 className="text-xl font-semibold">Klassbunden gallring</h1><p role="alert">Välj ett bolag där du har aktuell uttrycklig retention- och klassbehörighet. Underlagen kunde inte verifieras; inga ingrepp är tillgängliga.</p></main>}
}
