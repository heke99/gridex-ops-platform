import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {readExistingAckBeforeDraft} from '@/lib/ediel/core/ackDraftSource'
import {readReceivedErrApplicationResponseAuthority,receivedErrApplicationResponseQualification} from '@/lib/ediel/ack/receivedErrApplicationResponseAuthority'
import type {EdielMessageRow} from '@/lib/ediel/types'

/** A prescribed reply follows the committed incoming ERR owner. Retained
 * replies are read first, including originals whose old correlation has no
 * prospective capability. This operation neither accepts meter data nor
 * re-applies the rejected business transaction. */
export async function createReceivedErrApplicationAcks(input:{
  actorUserId:string;message:EdielMessageRow
  createAck:(scope:{sourceMessage:EdielMessageRow;relatedTransactionReference:string})=>Promise<EdielMessageRow>
  repairRetainedAck:(ack:EdielMessageRow)=>Promise<void>
}):Promise<string[]>{
  const m=input.message
  if(m.direction!=='inbound'||m.message_standard!=='edifact'||m.message_family!=='UTILTS_ERR'||!m.raw_payload)
    throw new Error('utilts_err_application_response_source_required')
  const wire=tokenizeEdifact(m.raw_payload),unh=wire.segments.filter(t=>t.tag==='UNH'),bgm=wire.segments.filter(t=>t.tag==='BGM')
  const refs=wire.segments.filter(t=>t.tag==='IDE').map(t=>segmentComposite(t,2,wire.una)[0])
  if(unh.length!==1||segmentComposite(unh[0],2,wire.una)[0]!=='UTILTS'||bgm.length!==1||segmentComposite(bgm[0],1,wire.una)[0]!=='ERR'
    ||!refs.length||refs.some(ref=>!ref)||new Set(refs).size!==refs.length)
    throw new Error('utilts_err_application_response_own_scope_required')
  const retained=new Map<string,EdielMessageRow>()
  for(const ref of refs){
    const old=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:m,ackFamily:'APERAK',
      outcome:'positive',ackScope:'transaction',acknowledgedReferences:[ref]})
    if(old)retained.set(ref,old)
  }
  for(const ack of retained.values())await input.repairRetainedAck(ack)
  if(retained.size===refs.length)return refs.map(ref=>retained.get(ref)!.id)
  const authority=await readReceivedErrApplicationResponseAuthority({message:m,actorUserId:input.actorUserId})
  if(!receivedErrApplicationResponseQualification({authority,message:m})
    ||JSON.stringify(authority.transactions.map(tx=>tx.transactionId))!==JSON.stringify(refs))
    throw new Error('utilts_err_application_response_own_scope_required')
  const ids:string[]=[]
  for(const tx of authority.transactions){
    const old=retained.get(tx.transactionId)
    const ack=old??await input.createAck({sourceMessage:authority.sourceMessage,relatedTransactionReference:tx.transactionId})
    ids.push(ack.id)
  }
  return ids
}
