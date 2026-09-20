import {segmentComposite,tokenizeEdifact,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {prodatRegisterTokens} from './prodatRegisterFields'
import {prodatRegisterGroups,prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {prodatFieldDiagnostic,prodatTokenFieldDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'

type EnergyInput={code?:string|null;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;applicationReference?:string|null}
export type EnergyApplicability='required'|'false'|'unknown'
const unusedEnergyFunctions=['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z15','Z18']
/** P20 shared-slot exclusion only; applicable242 retains its existing owner. */
export function incomingProduct242IsFalse(code:string):boolean {
  return ['Z01','Z02','Z03','Z05','Z08','Z09','Z13','Z14','Z15','Z18'].includes(code)
}

/** One incoming506 owner. No cached subtype, byCell, external history or field
 * presence supplies applicability. Descriptive parsing/raw evidence is untouched.
 * P20/68/119/122: fifth7110 is506; fourth7110 is always242.
 */
export function evaluateIncomingProdatEnergyProduct(input:EnergyInput){
  const una=input.una??parseUna(null),all=prodatRegisterTokens(input.rawSegments,una)
  const tokens=prodatRegisterMessageSegments(all,una),bgms=tokens.filter(t=>t.tag==='BGM')
  const full=all.some(t=>['UNB','UNH','UNT','UNZ'].includes(t.tag))
  const code=bgms.length===1?segmentComposite(bgms[0],1,una)[0]:full?'':input.code??''
  const firstEnd=all.findIndex(t=>['UNT','UNZ'].includes(t.tag)),first=firstEnd<0?all:all.slice(0,firstEnd)
  const unbs=first.filter(t=>t.tag==='UNB'),body=first.find(t=>['UNH','BGM','LIN'].includes(t.tag))
  const reference=full?(unbs.length===1&&body&&unbs[0].index<body.index?segmentComposite(unbs[0],7,una):[]):[input.applicationReference??'']
  const permissionProcess=reference.length===1&&reference[0]==='23-DGI-PRODAT'
  const {groups}=prodatRegisterGroups(tokens,una,code)
  const issues:EdielRulebookIssue[]=[]
  const objects:{lineIndex:number;applicability:EnergyApplicability;value:string|null}[]=[]
  const isPair=(t:EdifactTokenizedSegment)=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]?.trim().toUpperCase()==='Z14'
  const fail=(kind:'missing'|'invalid',scope:readonly EdifactTokenizedSegment[],lineIndex?:number,token?:EdifactTokenizedSegment)=>issues.push({
    severity:'error',blocking:true,code:kind==='missing'?'PRODAT_ENERGY_PRODUCT_REQUIRED':'PRODAT_ENERGY_PRODUCT_INVALID',
    title:kind==='missing'?'Energiprodukt saknas':'Ogiltig energiprodukt',
    description:`Fält 506, P26.A s.20,68,119,122: ${kind==='missing'?'obligatoriskt eget energiprodukt-id saknas':'eget energiprodukt-id, kvalificerare eller placering är ogiltig'}.`,fieldPath:'CCI++Z14/CAV',
    prodatDiagnostic:token?prodatTokenFieldDiagnostic('506',{...input,code},token,'PRODAT26A:P20/68/119/122'):prodatFieldDiagnostic('506',kind,{...input,code},scope.map(t=>t.raw),'PRODAT26A:P20/68/119/122',lineIndex),
  })
  for(const group of groups){
    const scope=group.segments,boundary=scope.findIndex(t=>['RFF','NAD'].includes(t.tag)),common=boundary<0?scope:scope.slice(0,boundary)
    const reasons=scope.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]?.trim().toUpperCase()==='Z13')
    const reasonCci=reasons[0],reasonCav=reasonCci?scope[scope.indexOf(reasonCci)+1]:undefined
    const reasonParts=reasonCav?.tag==='CAV'?segmentComposite(reasonCav,1,una):[]
    const reason=reasons.length===1&&common.includes(reasonCci)&&segmentComposite(reasonCci,2,una)[0]==='Z13'&&!reasonParts.slice(1).some(v=>v.trim())?reasonParts[0]:null
    const applicability:EnergyApplicability=unusedEnergyFunctions.includes(code)?'false':code==='Z14'&&reason==='Z96'?'false':permissionProcess&&(code==='Z13'||code==='Z14'&&['S17','S18'].includes(reason??''))?'required':'unknown'
    const object={lineIndex:group.lineIndex,applicability,value:null as string|null};objects.push(object)
    if(applicability!=='required')continue
    const supplied=scope.filter((t,index)=>{if(!isPair(t))return false;const cav=scope[index+1],parts=cav?.tag==='CAV'?segmentComposite(cav,1,una):[];return Boolean(parts[4]?.trim())})
    if(!supplied.length){fail('missing',scope,group.lineIndex);continue}
    for(const cci of supplied){
      const cav=scope[scope.indexOf(cci)+1],parts=segmentComposite(cav,1,una),value=parts[4]??''
      // National unused CCI metadata is residual extra information. The source
      // explicitly assigns incorrect C889 1131/3055 to the applicable field.
      const invalid=supplied.length!==1||!common.includes(cci)||segmentComposite(cci,2,una)[0]!=='Z14'||value!=='8716867000030'||value.length>35||Boolean(parts[1]?.trim()||parts[2]?.trim())
      if(invalid)fail('invalid',scope,group.lineIndex)
      else object.value=value
    }
  }
  if(code==='Z13'&&permissionProcess&&!groups.length)fail('missing',[])
  const firstLin=tokens.findIndex(t=>t.tag==='LIN'),header=firstLin<0?tokens:tokens.slice(0,firstLin)
  if(objects.some(o=>o.applicability==='required'))for(const cci of header.filter(isPair)){
    const cav=tokens[tokens.indexOf(cci)+1]
    if(cav?.tag==='CAV'&&segmentComposite(cav,1,una)[4]?.trim())fail('invalid',[],undefined,cci)
  }
  return {issues,objects}
}

/** Manual/TGT has no qualified506 mapping; only a genuine typed F adds a hold.
 * Invoke before permission events/positive returns and independent registry IO.
 */
export function assertIncomingProdatEnergyProductReview(rawPayload:string|null|undefined):void {
  const wire=tokenizeEdifact(rawPayload??'')
  const result=evaluateIncomingProdatEnergyProduct({rawSegments:wire.segments.map(t=>t.raw),una:wire.una})
  if(projectProdatDiagnostics(result.issues).applicationErrors.length)throw new Error('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')
}
