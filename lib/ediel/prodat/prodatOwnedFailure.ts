import {PRODAT_26A_FIELD_MATRIX} from './prodat26AFieldMatrix'
import {prodatPartyState} from './prodatPartyFields'
import {prodatDateState} from './prodatDateFields'
import {prodatDocumentState} from './prodatDocumentFields'
import {prodatRegisterFieldState} from './prodatRegisterFields'
import {prodatComponentEvidence,type ProdatFailureEvidence} from './prodatFailureEvidence'
import {segmentComposite,segmentElementCount,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'

/** Metadata transport for an already-classified F in the caller's exact scope.
 * Readers retain the components they validated. This does not classify a field,
 * infer requiredness, or search a different object for a convenient value. */
export function prodatOwnedFailure(field:typeof PRODAT_26A_FIELD_MATRIX[number], tokens:readonly EdifactTokenizedSegment[], una:EdifactServiceStringAdvice):ProdatFailureEvidence|undefined {
  if(field.partyQualifier){
    const parties=tokens.filter(t=>t.tag==='NAD'&&segmentComposite(t,1,una)[0]===field.partyQualifier)
    if(parties.length>1)return parties.flatMap(t=>prodatComponentEvidence(t.raw,field.segmentPath,segmentComposite(t,field.partyElement!,una)))
    return prodatPartyState(field.fieldNumber,tokens,una).failureEvidence
  }
  if(field.dateQualifier)return prodatDateState(field.fieldNumber,tokens.filter(t=>t.tag==='DTM'&&segmentComposite(t,1,una)[0]===field.dateQualifier),una).failureEvidence
  if(field.documentElement)return prodatDocumentState(field.fieldNumber,tokens,una).failureEvidence
  const register=prodatRegisterFieldState(field.fieldNumber,tokens,una)
  if(register)return register.failureEvidence
  if(field.referenceScope){
    const matches=tokens.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,una)[0]?.trim().toUpperCase()===field.segmentPath.slice(4))
    return matches.flatMap(t=>{const count=segmentElementCount(t,una),p=Array.from({length:count},(_,i)=>segmentComposite(t,i+1,una)).flat();return prodatComponentEvidence(t.raw,field.segmentPath,p,matches.length===1&&count===1&&p.length===2&&p[1]?[1]:undefined)})
  }
  if(field.cavComponent!==undefined){
    const matches=tokens.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]?.trim().toUpperCase()===field.segmentPath.slice(5,-4))
    return matches.flatMap(t=>{
      const candidates:EdifactTokenizedSegment[]=[]
      for(let i=tokens.indexOf(t)+1;tokens[i]?.tag==='CAV';i++)candidates.push(tokens[i])
      const cciStructural=segmentComposite(t,1,una).some(Boolean)||segmentComposite(t,2,una).slice(1).some(Boolean)||segmentElementCount(t,una)>2
      // Cardinality and unused-element failures belong to the complete submitted
      // pair/candidates. A convenient valid first scalar cannot explain them.
      const selected=cciStructural||!candidates.length?[t,...candidates]:candidates
      return selected.flatMap(candidate=>{
        const count=segmentElementCount(candidate,una),parts=Array.from({length:count},(_,i)=>segmentComposite(candidate,i+1,una)).flat()
        const scalar=matches.length===1&&candidates.length===1&&!cciStructural&&candidate.tag==='CAV'&&count===1&&parts.length<=5&&parts.every((p,i)=>i===field.cavComponent||!p)
        return prodatComponentEvidence(candidate.raw,field.segmentPath,parts,scalar?[field.cavComponent!]:undefined)
      })
    })
  }
  const tag=field.fieldNumber==='311'?'UNB':field.fieldNumber==='312'?'UNH':field.fieldNumber==='301'||field.fieldNumber==='303'?'FTX':null
  const matches=tokens.filter(t=>t.tag===tag)
  return matches.flatMap(t=>prodatComponentEvidence(t.raw,field.segmentPath,segmentComposite(t,tag==='UNB'?7:tag==='UNH'?2:4,una),tag==='UNH'?[4]:undefined))
}
