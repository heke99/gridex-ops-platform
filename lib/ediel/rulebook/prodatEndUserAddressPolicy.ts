import {segmentComposite,segmentElementCount} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {prodatRegisterGroups,prodatRegisterMessageSegments} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveProdatEndUserGroupRequirement} from '@/lib/ediel/prodat/prodatParentApplicability'
import {prodatEndUserWireSubtype} from './prodatEndUserPolicy'
import {copyProdatEndUserAddressObjects,END_USER_ADDRESS_CODES,prodatEndUserAddressWireLines} from '@/lib/ediel/prodat/prodatEndUserAddress'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type {EdielRulebookIssue} from './rulebook'

/** One outbound policy for the eight229 cells. Inbound callers do not invoke
 * business-source qualification. No output/root/status can manufacture a fact. */
type AddressPolicyInput={code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;facts?:ProdatDependentConditionFacts|null}
type AddressPolicyResult={issues:EdielRulebookIssue[];status:'required'|'not_required'|'undetermined'}
export function validateProdatEndUserAddress(input:AddressPolicyInput):EdielRulebookIssue[] {
  return evaluateProdatEndUserAddress(input).issues
}
export function evaluateProdatEndUserAddress(input:AddressPolicyInput):AddressPolicyResult {
  if(!END_USER_ADDRESS_CODES.includes(input.code))return {issues:[],status:'not_required'}
  const issues:EdielRulebookIssue[]=[]
  const fail=(code:string,description:string)=>issues.push({scope:'prodat_dependent',severity:'error',blocking:true,
    code:code==='UNDETERMINED'?'PRODAT_DEPENDENT_CONDITION_UNDETERMINED':`PRODAT_END_USER_ADDRESS_${code}`,title:'Elanvändaradress saknar giltigt underlag',description:`${input.code}:229, P26.A s.22/79/117-118: ${description}`,fieldPath:'NAD+UD/C059/3042[1..3]'})
  let facts
  try {facts=input.facts?.endUserAddressObjects===undefined?[]:copyProdatEndUserAddressObjects(input.facts.endUserAddressObjects)}
  catch {fail('EVIDENCE_INVALID','adressfakta är ogiltiga eller tvetydiga');return {issues,status:'undetermined'}}
  const una=input.una??parseUna(null), tokens=prodatRegisterMessageSegments(input.rawSegments,una)
  const grouped=prodatRegisterGroups(tokens,una,input.code)
  if(grouped.problems.length)fail('SCOPE_INVALID','objektets registerstruktur är ogiltig')
  const first=grouped.groups.filter(group=>group.registerPosition===1)
  const seen=new Set<string>()
  let available=false
  for(const group of first) {
    const key=JSON.stringify([group.itemId,group.identityAgency]);seen.add(key)
    const requirement=['Z06','Z09'].includes(input.code)?resolveProdatEndUserGroupRequirement(input.code,prodatEndUserWireSubtype(input.code,group.segments,una)):'required'
    const parties=group.segments.filter(s=>s.tag==='NAD' && segmentComposite(s,1,una)[0]?.trim().toUpperCase()==='UD')
    if(requirement==='forbidden') {if(parties.length)fail('PARENT_FORBIDDEN',`${key}: UD är inte tillämplig`);continue}
    if(requirement!=='required') {fail('UNDETERMINED',`${key}: egen transaktionsorsak kan inte fastställas`);continue}
    if(!group.itemId || !['9','89'].includes(group.identityAgency??''))fail('SCOPE_INVALID','exakt objektidentitet och kod krävs')
    if(parties.length!==1) {fail('PARENT_INVALID',`${key}: exakt en egen UD krävs`);continue}
    const party=parties[0],role=segmentComposite(party,1,una),address=segmentComposite(party,5,una)
    if(role.length!==1 || role[0]!=='UD' || segmentElementCount(party,una)>9 || address.length>3
      || address.some(v=>v.length>35 || /[\x00-\x1f\x7f]/.test(v)) || (!address[0]?.trim() && address.slice(1).some(v=>v.trim())))fail('FORMAT_INVALID',`${key}: C059 kräver högst tre35-teckens komponenter och p118 första fält`)
    const fact=facts.find(f=>f.meteringPointId===group.itemId && f.identityAgency===group.identityAgency)
    if(!fact || fact.availability==='unknown') {fail('UNDETERMINED',`${key}: självständigt valt adressunderlag saknas`);continue}
    const identity=segmentComposite(party,2,una)
    if(identity.length>3 || identity[0]!==fact.endUser.id || (identity[1]??'')!==fact.endUser.qualifier || identity[2]!==fact.endUser.agency)fail('IDENTITY_MISMATCH',`${key}: vald elanvändare avviker`)
    if(fact.availability==='unavailable') {if(address.some(v=>v.trim()))fail('FORBIDDEN',`${key}: adress får inte anges när underlaget säger att den saknas`);continue}
    available=true
    const expected=prodatEndUserAddressWireLines(fact.addressLines)
    if([0,1,2].some(i=>(address[i]??'').trim()!==(expected[i]??'')))fail('VALUE_MISMATCH',`${key}: adressens komponenter avviker från valt underlag`)
  }
  if(!first.length)fail('SCOPE_INVALID','inget första objekt finns')
  for(const fact of facts)if(!seen.has(JSON.stringify([fact.meteringPointId,fact.identityAgency])))fail('SOURCE_OBJECT_MISSING','valt källobjekt saknas i meddelandet')
  // A header party or a later message cannot fill the selected first object.
  const firstLine=tokens.findIndex(s=>s.tag==='LIN')
  if(tokens.slice(0,firstLine<0?tokens.length:firstLine).some(s=>s.tag==='NAD' && segmentComposite(s,1,una)[0]?.trim().toUpperCase()==='UD'))fail('SCOPE_INVALID','UD ligger utanför objektet')
  return {issues,status:issues.length?'undetermined':available?'required':'not_required'}
}
