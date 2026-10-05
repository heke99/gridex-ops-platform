import {copyGasReportingIdentitySelection,gasReportingIdentityValue,type GasReportingIdentitySelection} from '@/lib/ediel/prodat/prodatGasReportingIdentity'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {copyGasSerialChangeSelection,gasRequirement,gasStatus,gasWireMessages,isGasApplicabilityField,type GasRequirement,type GasSerialChangeObject} from '@/lib/ediel/prodat/prodatGasApplicability'
import {prodatRegisterTokens} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingSubtype} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {prodatReferenceEntries} from '@/lib/ediel/prodat/prodatReferenceFields'
import {segmentComposite,segmentElementCount,type EdifactTokenizedSegment as Token} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type {EdielRulebookIssue} from './rulebook'
export type GasPolicyInput={code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;facts?:ProdatDependentConditionFacts|null;direction?:'inbound'|'outbound';applicationReference?:string|null;fields?:readonly string[]}
export type GasIssue=EdielRulebookIssue&{meteringPointId?:string|null;lineItemReference?:string|null}
/** Shared five-cell wire owner. Diagnostic scope never confers GAS execution authority. */
export function evaluateProdatGasApplicability(input:GasPolicyInput){
  const una=input.una??parseUna(null),outbound=input.direction!=='inbound'
  const tokens=prodatRegisterTokens(input.rawSegments,una),messages=gasWireMessages(tokens,una,input.applicationReference)
  const issues:GasIssue[]=[],requirements=new Map<string,GasRequirement>()
  let objects:readonly GasSerialChangeObject[]=[]
  let reportingIdentity:GasReportingIdentitySelection|null|undefined
  let diagnosticScope:string[]=[];let diagnosticInput=input
  const fail=(field:string,suffix:string,detail:string,location?:{meteringPointId:string|null;lineItemReference:string|null},blocking=outbound,kind:'missing'|'invalid'|'local_evidence'='local_evidence')=>issues.push({
    prodatDiagnostic:kind==='local_evidence'?prodatLocalDiagnostic(kind,'PRODAT26A:gas-applicability',detail):prodatFieldDiagnostic(field,kind,diagnosticInput,diagnosticScope,'PRODAT26A:P21/77/119/123'),
    ...location,scope:'prodat_dependent',severity:blocking?'error':'warning',blocking,code:`PRODAT_GAS_${field?field+'_':''}${suffix}`,
    title:'PRODAT naturgasfält',description:`P26.A s.21/77/119/123${field?', fält '+field:''}: ${detail}`,fieldPath:field==='320'?'RFF+Z08':field==='240'?'RFF+Z06':undefined,
  })
  try{if(input.facts?.gasSerialChange!=null)objects=copyGasSerialChangeSelection(input.facts.gasSerialChange).objects}catch{fail('','EVIDENCE_INVALID','ogiltig lokal bedömning')}
  const scoped=messages.filter(m=>!m.family||m.family==='PRODAT').map(m=>({...m,code:m.code??(m.fragment?input.code:''),groups:prodatRegisterGroups(m.segments,una,m.code??input.code).groups}))
  // A selection has no message ID: repeated identity/process/LI use is ambiguous,
  // even when two messages happen to carry identical data.
  const binding=(id:string|null,agency:string|null,code:string,li:string|null)=>JSON.stringify([id,agency,code,li])
  const liValue=(segments:Token[])=>{
    // Count even blank/malformed occurrences before qualification. The descriptive
    // reference reader normalizes and drops blanks, so cannot establish authority.
    const entries=segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,una)[0]?.trim().toUpperCase()==='LI')
    if(entries.length!==1)return null
    const token=entries[0],parts=segmentComposite(token,1,una),party=segments.findIndex(t=>t.tag==='NAD')
    if(segmentComposite(token,0,una)[0]!=='RFF'||parts[0]!=='LI'||!parts[1]?.trim()||parts[1].length>35||parts.slice(2).some(Boolean)||segmentElementCount(token,una)!==1||(party>=0&&segments.indexOf(token)>party))return null
    return parts[1]
  }
  const uses=new Map<string,number>()
  for(const m of scoped)for(const g of m.groups.filter(g=>g.registerPosition===1||!g.validRegisterChain)){
    const key=binding(g.itemId,g.identityAgency,m.code,liValue(g.segments));uses.set(key,(uses.get(key)??0)+1)
  }
  const add=(field:string,value:GasRequirement)=>{
    const old=requirements.get(field)
    requirements.set(field,!old?value:old==='undetermined'||value==='undetermined'?'undetermined':old===value?value:old==='required'||value==='required'?'required':'undetermined')
  }
  for(const message of scoped){
    diagnosticInput={...input,code:message.code,rawSegments:message.segments.map(t=>t.raw)}
    const fields=['320','240'].filter(f=>isGasApplicabilityField(message.code,f)&&(!input.fields||input.fields.includes(f)))
    const first=message.groups.filter(g=>g.registerPosition===1||!g.validRegisterChain)
    for(const field of fields){
      const qualifier=field==='320'?'Z08':'Z06'
      const occurrences=message.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,una)[0]?.trim().toUpperCase()===qualifier)
      // Source false/X precedence applies before checking placement, blankness or components.
      if(message.market==='electricity'){
        add(field,'forbidden');if(outbound&&occurrences.length)fail(field,'FORBIDDEN','fältet får inte skickas i elmarknaden',undefined,true,'invalid')
        continue
      }
      if(!first.length){add(field,'undetermined');if(outbound)fail(field,'SCOPE_INVALID','eget första LIN-objekt saknas');continue}
      if(outbound&&occurrences.some(t=>!first.some(g=>g.segments.includes(t))))fail(field,'OCCURRENCE_INVALID','fältet ligger utanför eget första register')
      for(const group of first){
        diagnosticScope=group.segments.map(t=>t.raw)
        const subtype=prodatRegisterReadingSubtype(message.code,group.segments,una),li=liValue(group.segments)
        const location={meteringPointId:group.itemId,lineItemReference:li}
        const scope=Boolean(group.itemId)&&['9','89'].includes(group.identityAgency??'')&&group.validRegisterChain&&Boolean(subtype)
        let fact=objects.find(o=>o.installation.id===group.itemId&&o.installation.agency===group.identityAgency)
        if(fact&&(fact.process.code!==message.code||fact.process.reason!==(subtype==='M'?'E58':subtype==='F'?'E64':subtype==='G'?'E32':null)||fact.lineItemReference!==li||uses.get(binding(group.itemId,group.identityAgency,message.code,li))!==1)){
          if(field==='240')fail(field,'CONTEXT_MISMATCH','bedömningen tillhör inte ett entydigt eget objekt/process/LI')
          fact=undefined
        }
        const requirement=scope?gasRequirement(message.code,field,message.market,subtype,fact?.assessment.kind==='known'?fact.assessment.changed:undefined):'undetermined'
        add(field,requirement)
        if(!outbound&&(field==='240'||requirement==='forbidden'))continue // Grey permission adopted as bounded no-new-rejection policy.
        if(requirement==='undetermined'){fail(field,'UNDETERMINED','egen marknad/process eller oberoende händelsebedömning saknas',location);continue}
        const found=group.segments.filter(t=>occurrences.includes(t))
        if(requirement==='forbidden'){if(found.length)fail(field,'FORBIDDEN','fältet får inte skickas för egen process',location,true,'invalid');continue}
        const ownRefs=new Set(prodatReferenceEntries(group.segments,una).filter(e=>e.qualifier===qualifier).map(e=>e.raw))
        const party=group.segments.findIndex(t=>t.tag==='NAD')
        // Blank values still need their own source-backed content diagnostic.
        const placed=found.every(t=>(party<0||group.segments.indexOf(t)<party)&&(ownRefs.has(t.raw)||!segmentComposite(t,1,una)[1]))
        if(found.length>1||!placed){fail(field,'OCCURRENCE_INVALID','en entydig RFF i eget SG16 krävs',location,true,'invalid');continue}
        if(!found.length){if(requirement==='required')fail(field,'REQUIRED','värdet saknas i eget första register',location,true,'missing');continue}
        const token=found[0],parts=segmentComposite(token,1,una),value=parts[1]??''
        if(parts[0]!==qualifier||!value.trim()||value.length>35||(field==='240'&&/[åäöÅÄÖ]/.test(value)))fail(field,'VALUE_INVALID','1154 ska vara ett giltigt icke-tomt an..35-värde',location,true,'invalid')
        if(outbound&&(parts.slice(2).some(Boolean)||segmentElementCount(token,una)>1))fail(field,'UNUSED_COMPONENT','1156/4000 och övriga oanvända delar får inte skickas',location,true,'invalid')
        if(field==='240'&&outbound){
          if(reportingIdentity===undefined){
            try{reportingIdentity=input.facts?.gasReportingIdentity==null?null:copyGasReportingIdentitySelection(input.facts.gasReportingIdentity)}catch{reportingIdentity=null}
          }
          const reason=({L:'Z22',LK:'Z23',C:'Z24',H:'Z25',A:'Z26',D:'Z70',E:'E34',F:'E64',G:'E32',M:'E58'} as Record<string,string>)[subtype??'']??null
          const expected=gasReportingIdentityValue(reportingIdentity,{id:group.itemId,agency:group.identityAgency,lineItemReference:li,code:message.code,reason,unique:uses.get(binding(group.itemId,group.identityAgency,message.code,li))===1,causal:fact})
          if(expected===null)fail(field,'IDENTITY_UNDETERMINED','oberoende egen MSCONS-TIM/SCH-identitet och exakt källrevision saknas',location)
          else if(value!==expected)fail(field,'IDENTITY_MISMATCH','serie-id motsvarar inte egen källstyrkt MSCONS-TIM/SCH-identitet',location,true,'invalid')
        }
      }
    }
  }
  return {issues,requirements,statuses:new Map([...requirements].map(([field,value])=>[field,gasStatus(value)]))}
}
export const validateProdatGasApplicability=(input:GasPolicyInput)=>evaluateProdatGasApplicability(input).issues
