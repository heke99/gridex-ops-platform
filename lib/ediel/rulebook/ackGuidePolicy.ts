import {commonHeaderOriginalSource,commonHeaderRejectionField,commonHeaderReplyApplicationReference,prodatCommonHeaderRejectionQualification,type ProdatCommonHeaderRejectionEvidence} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import {tokenizeEdifact,observeCompletedEdifactSegments,segmentComposite,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {CanonicalEdielPolicy} from './canonicalEdielPolicy'
import type {EdielRulebookIssue} from './rulebook'
import {PRODAT_APERAK_FIELD_NAMES,PRODAT_APERAK_APPLICATION_TEXTS,prodatAperakFieldWireLabel} from '@/lib/ediel/prodat/prodatAperakText'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {utiltsErrSourceCopyViolations} from '@/lib/ediel/utilts/errSourceCopy'
import {UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS,validUtiltsLegalIdentity} from '@/lib/ediel/utilts/headerIdentityGuide'
import {UTILTS_25_A_3_POLICY,UTILTS_25_A_4_POLICY} from './utilts25A4'
import {canonicalRegisteredEdielGuideScopes} from './canonicalEdielFacade'
import {validateEdifactHeaderGuide} from './edifactHeaderGuide'

import type {TechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
/** Source projection port for native admission. The TS guide consumer below
 * reads these same constants; generators must preserve its source references
 * and edition and must not interpret this table as approval of original data. */
export const CANONICAL_ACK_GUIDE_CONSTRAINTS=Object.freeze({
 version:1,common:Object.freeze({documentDate:Object.freeze({qualifier:'137',format:'203',pattern:'^[0-9]{12}$'}),positiveText:'OK'}),
 PRODAT:Object.freeze({technicalProfile:Object.freeze(['APERAK','D','96A','UN','E2SE6A']),allowedErc:Object.freeze(['100','40','41','42']),allowedFunctions:Object.freeze(['27','34']),unusedDocumentElements:Object.freeze([1,2]),legalAgency:'SVK',legalQualifier:'160',countryPattern:'^[A-Z]{2}$',missingSuffix:' saknas',missingCustomerPrefix:' saknas, kundid',invalidPrefix:'Felaktigt ',agency:'260',textQualifier:'AAO',textMax:70,fieldReferenceMax:3,fieldLabels:Object.freeze(Object.fromEntries(Object.keys(PRODAT_APERAK_FIELD_NAMES).map(key=>[key,prodatAperakFieldWireLabel(key)]))),applicationTexts:PRODAT_APERAK_APPLICATION_TEXTS,source:Object.freeze({id:'P',sections:Object.freeze(['3.3','3.4','3.5']),pages:Object.freeze([89,105]),availableBasis:'authenticated_original_page_excerpt'})}),
 UTILTS:Object.freeze({technicalProfile:Object.freeze(['APERAK','D','04A','UN','E5SE5A']),allowedErc:Object.freeze(['100','41','42']),allowedDocumentStatuses:Object.freeze(['312','313']),messageFunction:'9',documentIdMax:35,fixedOffset:Object.freeze(['735','+0100','406']),legalAgencies:Object.freeze(['260','9','305']),svkAgency:'260',svkQualifier:'SVK',agency:'260',textQualifier:'AAO',textMax:512,fieldReferenceMax:17,ownDmMax:70,originalAcwMax:70,missingText:'MANDATORY FIELD MISSING',invalidTextPattern:'^INCORRECT DATA .+$',source:Object.freeze({id:'U',sections:Object.freeze(['5.3','5.4','5.5']),pages:Object.freeze([108,119]),availableBasis:'authentic_original'})}),
 CONTRL:Object.freeze({technicalProfile:Object.freeze(['CONTRL','2','2','UN']),optionalAssociation:'EDIEL2',allowedActions:Object.freeze(['1','4']),forbiddenSegments:Object.freeze(['BGM','DOC','ERC','FTX','RFF','NAD']),originalUciMax:14,source:Object.freeze({id:'T',section:'2.1',availableBasis:'frozen_authenticated_contract'})}),
})
/** U §3.7.4 pp66–68 and the original validity appendix pp122–126, field531.
 * This is the single ERR guide source port used by TS and native projection;
 * immutable own functional facets separately authorize an actual response. */
export const CANONICAL_UTILTS_ERR_GUIDE_CONSTRAINTS=Object.freeze({
 version:1,technicalProfile:Object.freeze(['UTILTS','D','02B','UN','E5SE5A']),documentCode:'ERR',documentAgency:'260',optionalDocumentCodeLists:Object.freeze(['','SVK']),
 documentIdMax:35,allowedFunctions:Object.freeze(['5','9']),allowedAcknowledgementRequests:Object.freeze(['AB','NA']),
 documentDate:Object.freeze({...CANONICAL_ACK_GUIDE_CONSTRAINTS.common.documentDate,noFuture:true}),fixedOffset:CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.fixedOffset,
 marketCodes:Object.freeze(['23','27']),phaseCodes:Object.freeze(['E02','E03','E04']),agency:'260',
 identity:UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS,legalAgencies:UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS.legalAgencies,svkAgency:'260',svkQualifier:UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS.edielQualifier,
 subordinateRoles:UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS.ancillaryRoles,
 transactionQualifier:'24',ownTransactionIdMax:35,originalTransactionIdMax:70,responseQualifier:'E01',responseStatus:'41',referenceQualifier:'TN',
 allowedReasons:Object.freeze(['E10','E14','E16','E18','E29','E47','E49','E50','E51','E55','E61','E62','E73','E87','E90','E97','E98']),
 originalMessageCodes:Object.freeze(['E30','E31','E66','E72','E73','E74','S01','S02','S03','S04','S05','S06','S07']),
 forbiddenSegments:Object.freeze(['ERC','FTX','DOC','LIN','SEQ','QTY','MEA','CCI','CAV']),
 source:Object.freeze({id:'U',section:'3.7.4',pages:Object.freeze([66,68]),reasonField:'531',validityPages:Object.freeze([122,126]),availableBasis:'authentic_original'}),
})
/** Authentic prior U SHA fad5cf4f... p131 field531 includes E19; p138
 * describes its own meter-reading comparison. The existing dated overlay
 * removes E19. A reply inherits the original guide, rather than its send date.
 * Native consumers project this same data against protected named originals. */
export const CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES=Object.freeze(canonicalRegisteredEdielGuideScopes()
 .filter(scope=>scope.family==='UTILTS').map(scope=>{
  const processability=[UTILTS_25_A_3_POLICY,UTILTS_25_A_4_POLICY].find(policy=>policy.guideRevision===scope.canonicalGuideRevision)
  if(!processability)throw new Error('canonical_err_reason_guide_scope_unavailable')
  const base=[...CANONICAL_UTILTS_ERR_GUIDE_CONSTRAINTS.allowedReasons,...UTILTS_25_A_4_POLICY.removedRejectionReasonCodes]
  return Object.freeze({...scope,allowedReasons:Object.freeze(base.filter(reason=>!processability.removedRejectionReasonCodes.includes(reason))),
   source:Object.freeze({document:processability.source.document,sha256:processability.structuralComparisonSource.sha256,
    field:'531',pages:Object.freeze(processability===UTILTS_25_A_3_POLICY?[131,138]:[126,132])})})
 }))
export function canonicalUtiltsErrReasonsForPolicy(policy:CanonicalEdielPolicy):readonly string[]|null {
 if(policy.family!=='UTILTS_ERR')return null
 const scope=CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES.find(scope=>scope.canonicalGuideRevision===policy.guide.guideRevision
  &&scope.associationAssignedCode===policy.associationAssignedCode)
 return scope?.allowedReasons??null
}
type Wire=ReturnType<typeof tokenizeEdifact>
const equal=(a:readonly string[],b:readonly string[])=>JSON.stringify(a)===JSON.stringify(b)
function value(wire:Wire,segment:EdifactTokenizedSegment | undefined,index:number){return segmentComposite(segment,index,wire.una)[0] ?? ''}
function references(wire:Wire,tokens:readonly EdifactTokenizedSegment[],qualifier:string){return tokens.filter(t=>t.tag==='RFF'&&value(wire,t,1)===qualifier).map(t=>segmentComposite(t,1,wire.una)[1] ?? '')}
function one(values:readonly string[]){return values.length===1&&values[0].length>0?values[0]:null}
function dateTime(value:string){
 if(!/^\d{12}$/.test(value))return false
 const year=Number(value.slice(0,4)),month=Number(value.slice(4,6)),day=Number(value.slice(6,8)),hour=Number(value.slice(8,10)),minute=Number(value.slice(10,12)),d=new Date(Date.UTC(year,month-1,day,hour,minute))
 return year>0&&d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day&&d.getUTCHours()===hour&&d.getUTCMinutes()===minute
}
/** National ACK constraints only: P26.A §§3.3–3.5 pp89–105 (authenticated
 * original excerpt), U §§5.3–5.5 pp108–119 (original SHA0524c18f…), and T§2.1
 * literal CONTRL contract. The selected immutable policy is the sole guide
 * authority. Full UNSM structure remains a separate source/evidence requirement.
 * Optional original bytes qualify conditional references; a parsed JSON marker
 * or a sibling ERC can never supply an own-object/transaction reference. */
export function validateCanonicalAckGuide(input:{policy:CanonicalEdielPolicy;rawSegments?:readonly string[]|null;rawPayload?:string|null;una?:EdifactServiceStringAdvice;sourceRawPayload?:string|null;technicalOriginal?:TechnicalSyntaxAckEvidence;commonHeaderOriginal?:ProdatCommonHeaderRejectionEvidence}):EdielRulebookIssue[]{
 if(!['CONTRL','APERAK','UTILTS_ERR'].includes(input.policy.family))return []
 const una=input.una??parseUna(null),wire=tokenizeEdifact(`${una.raw}${(input.rawSegments??[]).join(una.segmentTerminator)}${una.segmentTerminator}`),issues:EdielRulebookIssue[]=[]
 issues.push(...validateEdifactHeaderGuide({direction:input.policy.direction as 'inbound'|'outbound',rawPayload:input.rawPayload,rawSegments:input.rawSegments,una}))
 const add=(code:string,description:string,fieldPath?:string)=>issues.push({code,severity:'error',blocking:true,title:'Nationell kvittensanvisning',description,fieldPath})
 const segments=wire.segments,all=(tag:string)=>segments.filter(t=>t.tag===tag),type=segmentComposite(all('UNH')[0],2,wire.una)
 if(all('UNH').length!==1)add('ACK_GUIDE_ONE_MESSAGE_REQUIRED','Kvittensen ska avse ett eget fysiskt meddelande.','UNH')
 if(input.sourceRawPayload){
  const source=input.policy.family==='CONTRL'?observeCompletedEdifactSegments(input.sourceRawPayload):tokenizeEdifact(input.sourceRawPayload),originals=source.segments.filter(t=>t.tag==='UNB'),original=originals[0],outgoing=all('UNB')[0]
  const supplied=input.commonHeaderOriginal
  const evidence=supplied?prodatCommonHeaderRejectionQualification({evidence:supplied,companyId:supplied.companyId,environment:supplied.environment}):null
  const field=evidence?commonHeaderRejectionField(evidence):null
  const corrected=Boolean(evidence&&field?.fieldCode==='311'&&field.ercCode==='41'&&input.policy.family==='APERAK'
    &&commonHeaderOriginalSource(evidence)?.raw_payload===input.sourceRawPayload
    &&all('BGM').length===1&&value(wire,all('BGM')[0],3)==='27'&&all('ERC').length===1&&all('FTX').length===1
    &&equal(segmentComposite(all('ERC')[0],1,wire.una),['41','','260'])
    &&equal(segmentComposite(all('FTX')[0],3,wire.una),['311','','260'])
    &&equal(segmentComposite(all('FTX')[0],4,wire.una),[field.text]))
  const expectedApplication=corrected?[commonHeaderReplyApplicationReference(evidence!)??'']:segmentComposite(original,7,source.una)
  if(originals.length!==1||all('UNB').length!==1
   ||!equal(segmentComposite(outgoing,2,wire.una),segmentComposite(original,3,source.una))
   ||!equal(segmentComposite(outgoing,3,wire.una),segmentComposite(original,2,source.una))
   ||!equal(segmentComposite(outgoing,7,wire.una),expectedApplication)
   ||!equal(segmentComposite(outgoing,11,wire.una),segmentComposite(original,11,source.una)))add('ACK_ORIGINAL_TECHNICAL_ROUTE_MISMATCH','Kvittensens tekniska UNB-parter, application reference och miljö ska spegla det faktiska originalet.','UNB')
  if(input.policy.family==='UTILTS_ERR'&&value(source,source.segments.find(t=>t.tag==='UNH'),2)!=='UTILTS')add('ACK_SOURCE_FAMILY_MISMATCH','UTILTS-ERR måste tillhöra ett verkligt UTILTS-ursprung.','UNH')
 }
 if(input.policy.family==='UTILTS_ERR'){
  const cfg=CANONICAL_UTILTS_ERR_GUIDE_CONSTRAINTS
  const allowedReasons=canonicalUtiltsErrReasonsForPolicy(input.policy)
  if(!allowedReasons)add('ACK_UTILTS_ERR_ORIGINAL_GUIDE_UNQUALIFIED','ERR ska använda en styrkt originalanvisnings avvisningsorsaker.','STS/531')
  if(!equal(type,[...cfg.technicalProfile.slice(0,4),input.policy.associationAssignedCode??'']))add('ACK_UTILTS_ERR_PROFILE_INVALID','UTILTS-ERR ska använda det faktiska originalets tekniska UTILTS-version.','UNH/S009')
  const bgms=all('BGM'),bgm=bgms[0],name=segmentComposite(bgm,1,wire.una),id=segmentComposite(bgm,2,wire.una)
  if(bgms.length!==1||name[0]!==cfg.documentCode||name[2]!==cfg.documentAgency||!cfg.optionalDocumentCodeLists.includes(name[1]??'')||name.slice(3).some(Boolean))add('ACK_UTILTS_ERR_DOCUMENT_CODE_INVALID','UTILTS-ERR ska ha dokumentnamn ERR och kodlistansvarig260.','BGM/202')
  if(!id[0]||id[0].length>cfg.documentIdMax||id.slice(1).some(Boolean))add('ACK_UTILTS_ERR_DOCUMENT_ID_INVALID','UTILTS-ERR ska ha ett eget entydigt dokument-id.','BGM/203')
  if(!cfg.allowedFunctions.includes(value(wire,bgm,3))||!cfg.allowedAcknowledgementRequests.includes(value(wire,bgm,4))||[3,4].some(index=>segmentComposite(bgm,index,wire.una).length!==1)||bgm?.elements.slice(5).some(Boolean))add('ACK_UTILTS_ERR_FUNCTION_REQUEST_INVALID','UTILTS-ERR ska ange meddelandefunktion5eller9 och kvittensbegäranABellerNA.','BGM/204/313')
  const dates=all('DTM').filter(t=>value(wire,t,1)===cfg.documentDate.qualifier),date=segmentComposite(dates[0],1,wire.una),offsets=all('DTM').filter(t=>value(wire,t,1)==='735')
  if(dates.length!==1||date.length!==3||date[2]!==cfg.documentDate.format||!dateTime(date[1]??''))add('ACK_UTILTS_ERR_DOCUMENT_DATE_INVALID','UTILTS-ERR ska ha ett giltigt eget meddelandedatum.','DTM/205')
  const admittedAt=input.policy.timeAnchors?.admissionAt
  if(dateTime(date[1]??'')&&admittedAt&&Number.isFinite(Date.parse(admittedAt))){const stamp=date[1],documentUtc=Date.UTC(Number(stamp.slice(0,4)),Number(stamp.slice(4,6))-1,Number(stamp.slice(6,8)),Number(stamp.slice(8,10)),Number(stamp.slice(10,12)))-60*60*1000;if(documentUtc>Date.parse(admittedAt))add('ACK_UTILTS_ERR_DOCUMENT_DATE_FUTURE','UTILTS-ERR datum får inte ligga efter den verkliga kontrollklockan i svensk normaltid.','DTM/205')}
  if(offsets.length!==1||!equal(segmentComposite(offsets[0],1,wire.una),cfg.fixedOffset))add('ACK_UTILTS_ERR_OFFSET_INVALID','UTILTS-ERR ska ange svensk fast tidszon.','DTM/206')
  for(const tag of cfg.forbiddenSegments)if(all(tag).length)add('ACK_UTILTS_ERR_SEGMENT_FORBIDDEN',`UTILTS-ERR får inte innehålla ${tag} från data- eller APERAK-meddelandet.`,tag)
  const firstIde=segments.findIndex(t=>t.tag==='IDE'),header=firstIde<0?segments:segments.slice(0,firstIde),markets=header.filter(t=>t.tag==='MKS'),market=markets[0]
  if(markets.length!==1||!cfg.marketCodes.includes(value(wire,market,1))||!cfg.phaseCodes.includes(value(wire,market,2))||segmentComposite(market,2,wire.una)[2]!==cfg.agency)add('ACK_UTILTS_ERR_MARKET_PHASE_INVALID','UTILTS-ERR ska kopiera originalets marknad och skede.','MKS/501/502')
  for(const qualifier of ['MS','MR']){
   const parties=header.filter(t=>t.tag==='NAD'&&value(wire,t,1)===qualifier),party=segmentComposite(parties[0],2,wire.una)
   if(parties.length!==1||!party[0]||party[0].length>35||!validUtiltsLegalIdentity({id:party[0],qualifier:party[1]??'',agency:party[2]??''}))add('ACK_UTILTS_ERR_LEGAL_PARTY_INVALID','UTILTS-ERR ska ange egna juridiska kvittensparter och rätt kvalifikatorer.','NAD/207/208')
  }
  const subordinate=header.filter(t=>t.tag==='NAD'&&!['MS','MR'].includes(value(wire,t,1)))
  if(subordinate.length!==1||!cfg.subordinateRoles.includes(value(wire,subordinate[0],1))||segmentComposite(subordinate[0],2,wire.una).some(Boolean))add('ACK_UTILTS_ERR_SUBORDINATE_ROLE_INVALID','UTILTS-ERR ska ange originalets underordnade avsändarroll.','NAD/509')
  const groups=segments.flatMap((t,index)=>t.tag==='IDE'?[segments.slice(index,segments.findIndex((next,nextIndex)=>nextIndex>index&&['IDE','UNT','UNZ'].includes(next.tag))<0?segments.length:segments.findIndex((next,nextIndex)=>nextIndex>index&&['IDE','UNT','UNZ'].includes(next.tag)))]:[]),ids:string[]=[],scopes:string[]=[]
  if(!groups.length)add('ACK_UTILTS_ERR_TRANSACTION_MISSING','UTILTS-ERR ska innehålla egna avvisningstransaktioner.','IDE/505')
  for(const group of groups){
   const own=segmentComposite(group[0],2,wire.una),responses=group.filter(t=>t.tag==='STS'&&value(wire,t,1)===cfg.responseQualifier),response=responses[0],status=segmentComposite(response,2,wire.una),reason=segmentComposite(response,3,wire.una),tn=references(wire,group,cfg.referenceQualifier)
   if(value(wire,group[0],1)!==cfg.transactionQualifier||!own[0]||own[0].length>cfg.ownTransactionIdMax||own.length!==1||ids.includes(own[0]))add('ACK_UTILTS_ERR_OWN_TRANSACTION_INVALID','ERR-transaktionsnumret ska vara eget och unikt.','IDE/505');ids.push(own[0]??'')
   const reasonFormValid=responses.length===1&&equal(segmentComposite(response,1,wire.una),[cfg.responseQualifier,'',cfg.agency])&&equal(status,[cfg.responseStatus])&&equal(reason,[reason[0]??'','',cfg.agency])&&!response?.elements.slice(4).some(Boolean)
   if(!reasonFormValid||!CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES.some(scope=>scope.allowedReasons.includes(reason[0]??'')))add('ACK_UTILTS_ERR_NATIONAL_REASON_INVALID','ERR ska ange STS41 och en faktisk nationell avvisningsorsak med kodlistansvarig260.','STS/528/531')
   else if(!allowedReasons?.includes(reason[0]??''))add('ACK_UTILTS_ERR_ORIGINAL_REASON_SCOPE_REQUIRED','Avvisningsorsaken kräver en styrkt tillämplig originalanvisning.','STS/531')
   if(!one(tn)||tn[0].length>cfg.originalTransactionIdMax||group.filter(t=>t.tag==='RFF'&&value(wire,t,1)===cfg.referenceQualifier).some(t=>segmentComposite(t,1,wire.una).length!==2))add('ACK_UTILTS_ERR_ORIGINAL_TRANSACTION_INVALID','ERR ska referera exakt ett fullständigt transaktionsnummer i originalet.','RFF/529')
   const scope=`${tn[0]??''}|${reason[0]??''}`;if(scopes.includes(scope))add('ACK_UTILTS_ERR_OWN_RESPONSE_DUPLICATE','Samma ursprungstransaktion och avvisningsorsak får inte dupliceras.','RFF/529');scopes.push(scope)
   const docs=group.filter(t=>t.tag==='RFF'&&cfg.originalMessageCodes.includes(value(wire,t,1)))
   if(group.some(t=>t.tag==='RFF'&&!cfg.originalMessageCodes.includes(value(wire,t,1))&&value(wire,t,1)!==cfg.referenceQualifier))add('ACK_UTILTS_ERR_REFERENCE_QUALIFIER_INVALID','ERR får bara innehålla sina föreskrivna egna originalreferenser.','RFF/503/529')
   if(docs.length!==1||!segmentComposite(docs[0],1,wire.una)[1]||segmentComposite(docs[0],1,wire.una).length!==2)add('ACK_UTILTS_ERR_ORIGINAL_DOCUMENT_INVALID','ERR ska kopiera ursprungsmeddelandets typ och dokument-id.','RFF/503/504')
  }
  if(input.sourceRawPayload){
   const source=tokenizeEdifact(input.sourceRawPayload),sourceHeaders=source.segments.filter(t=>t.tag==='UNH'),originalType=segmentComposite(sourceHeaders[0],2,source.una),sourceBgm=source.segments.filter(t=>t.tag==='BGM'),sourceFirstIde=source.segments.findIndex(t=>t.tag==='IDE'),originalHeader=sourceFirstIde<0?source.segments:source.segments.slice(0,sourceFirstIde)
   if(sourceHeaders.length!==1||!equal(type,originalType)||sourceBgm.length!==1||!cfg.originalMessageCodes.includes(value(source,sourceBgm[0],1)))add('ACK_UTILTS_ERR_ORIGINAL_PROFILE_MISMATCH','ERR ska ärva det faktiska originalets tekniska profil och dokumenttyp.','UNH/BGM')
   const originalMarkets=originalHeader.filter(t=>t.tag==='MKS'),originalSubordinate=originalHeader.filter(t=>t.tag==='NAD'&&!['MS','MR'].includes(value(source,t,1)))
   if(originalMarkets.length!==1||markets.length!==1||!equal(segmentComposite(originalMarkets[0],1,source.una),segmentComposite(market,1,wire.una))||!equal(segmentComposite(originalMarkets[0],2,source.una),segmentComposite(market,2,wire.una)))add('ACK_UTILTS_ERR_ORIGINAL_MARKET_MISMATCH','ERR får inte byta originalets marknad eller skede.','MKS/501/502')
   if(originalSubordinate.length!==1||subordinate.length!==1||value(source,originalSubordinate[0],1)!==value(wire,subordinate[0],1))add('ACK_UTILTS_ERR_ORIGINAL_ROLE_MISMATCH','ERR ska behålla den faktiska underordnade rollen från originalet.','NAD/509')
   for(const [own,opposite] of [['MS','MR'],['MR','MS']]){
    const original=originalHeader.filter(t=>t.tag==='NAD'&&value(source,t,1)===opposite),actual=header.filter(t=>t.tag==='NAD'&&value(wire,t,1)===own)
    if(original.length!==1||actual.length!==1||!equal(segmentComposite(original[0],2,source.una),segmentComposite(actual[0],2,wire.una)))add('ACK_UTILTS_ERR_ORIGINAL_LEGAL_PARTY_MISMATCH','Juridiska ERR-parter ska spegla originalets egna parter och kvalifikatorer.','NAD/207/208')
   }
   for(const group of groups){const refs=group.filter(t=>t.tag==='RFF'&&cfg.originalMessageCodes.includes(value(wire,t,1)));if(refs.length!==1||value(wire,refs[0],1)!==value(source,sourceBgm[0],1)||segmentComposite(refs[0],1,wire.una)[1]!==value(source,sourceBgm[0],2))add('ACK_UTILTS_ERR_ORIGINAL_DOCUMENT_MISMATCH','ERR ska kopiera känt ursprungligt dokument-id och dokumenttyp.','RFF/503/504')}
   for(const field of utiltsErrSourceCopyViolations(input.sourceRawPayload,`${wire.una.raw}${segments.map(t=>t.raw).join(wire.una.segmentTerminator)}${wire.una.segmentTerminator}`))add('ACK_UTILTS_ERR_ORIGINAL_COPY_MISMATCH',`ERR ska kopiera den egna ursprungstransaktionens tillgängliga fält${field}.`,`UTILTS/${field}`)
  }
  return issues
 }
 if(input.technicalOriginal){
  const original=input.technicalOriginal.originalUNB,unb=all('UNB'),uci=all('UCI')
  if(input.policy.family!=='CONTRL'||unb.length!==1||uci.length!==1
    ||!equal(segmentComposite(unb[0],2,wire.una),original.receiver)||!equal(segmentComposite(unb[0],3,wire.una),original.sender)
    ||value(wire,unb[0],7)!==original.applicationReference||value(wire,unb[0],11)!==original.testIndicator
    ||!equal(segmentComposite(uci[0],2,wire.una),original.sender)||!equal(segmentComposite(uci[0],3,wire.una),original.receiver)
    ||value(wire,uci[0],1)!==original.uciReference||value(wire,uci[0],4)!==(input.technicalOriginal.syntaxDecision==='accepted'?'1':'4')) {
      add('ACK_CONTRL_PROTECTED_SOURCE_SCOPE_MISMATCH','CONTRL ska spegla det skyddade originalets tekniska kuvert och fastställda syntaxutfall.','UNB/UCI')
    }
 }
 if(input.policy.family==='CONTRL'){
  if(!equal(type.slice(0,4),CANONICAL_ACK_GUIDE_CONSTRAINTS.CONTRL.technicalProfile)||(type[4]&&type[4]!==CANONICAL_ACK_GUIDE_CONSTRAINTS.CONTRL.optionalAssociation)||type.slice(5).some(Boolean))add('ACK_CONTRL_PROFILE_INVALID','CONTRL ska använda den svenska tekniska profilen.','UNH/S009')
  for(const tag of CANONICAL_ACK_GUIDE_CONSTRAINTS.CONTRL.forbiddenSegments)if(all(tag).length)add('ACK_CONTRL_NATIONAL_SEGMENT_FORBIDDEN',`CONTRL får inte innehålla ${tag} från applikationskvittensen.`,tag)
  const uci=all('UCI'),control=segmentComposite(uci[0],1,wire.una)
  if(uci.length!==1||control.length!==1||!control[0]||control[0].length>CANONICAL_ACK_GUIDE_CONSTRAINTS.CONTRL.originalUciMax)add('ACK_CONTRL_ORIGINAL_REFERENCE_INVALID','UCI ska kopiera ett entydigt ursprungligt överföringsnummer.','UCI/0020')
  if(!CANONICAL_ACK_GUIDE_CONSTRAINTS.CONTRL.allowedActions.includes(value(wire,uci[0],4)))add('ACK_CONTRL_ACTION_INVALID','UCI/0083 ska vara 1 eller 4.','UCI/0083')
  for(const index of [2,3])if(!segmentComposite(uci[0],index,wire.una)[0])add('ACK_CONTRL_ORIGINAL_PARTY_MISSING','UCI ska innehålla originalets tekniska parter.','UCI')
  if(input.sourceRawPayload){
   const source=observeCompletedEdifactSegments(input.sourceRawPayload),original=source.segments.find(t=>t.tag==='UNB')
   if(source.segments.some(t=>t.tag==='UNH'&&value(source,t,2)==='CONTRL')||value(wire,uci[0],1)!==value(source,original,5).slice(0,CANONICAL_ACK_GUIDE_CONSTRAINTS.CONTRL.originalUciMax)
     ||!equal(segmentComposite(uci[0],2,wire.una),segmentComposite(original,2,source.una))||!equal(segmentComposite(uci[0],3,wire.una),segmentComposite(original,3,source.una)))add('ACK_CONTRL_ORIGINAL_SCOPE_MISMATCH','UCI ska kopiera det faktiska originalets överföring och tekniska parter.','UCI')
  }
  return issues
 }
 const utilts=input.policy.guide.documentName.includes('UTILTS'),constraints=utilts?CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS:CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT
 if(utilts&&[2,3].some(index=>segmentComposite(all('UNB')[0],index,wire.una)[2]==='PRODAT'))add('ACK_UTILTS_PRODAT_SUBADDRESS_FORBIDDEN','UTILTS-APERAK får inte använda PRODAT-subadress.','UNB')
 if(!equal(type,[...constraints.technicalProfile.slice(0,4),input.policy.associationAssignedCode??'']))add('ACK_APERAK_PROFILE_INVALID','APERAK ska följa den redan valda ursprungsfamiljens tekniska profil.','UNH/S009')
 const bgms=all('BGM'),bgm=bgms[0]
 if(bgms.length!==1)add('ACK_APERAK_BGM_CARDINALITY','APERAK ska ha ett BGM.','BGM')
 if(utilts){
  if(!CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.allowedDocumentStatuses.includes(value(wire,bgm,1))||segmentComposite(bgm,1,wire.una).slice(1).some(Boolean))add('ACK_UTILTS_BGM_STATUS_INVALID','UTILTS-APERAK BGM ska vara 312 eller 313.','BGM/A202')
  const id=segmentComposite(bgm,2,wire.una)
  if(!id[0]||id[0].length>CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.documentIdMax||id.slice(1).some(Boolean))add('ACK_UTILTS_DOCUMENT_ID_INVALID','APERAK ska ha sitt eget oförändrade meddelande-id.','BGM/A203')
  if(value(wire,bgm,3)!==CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.messageFunction||segmentComposite(bgm,4,wire.una).some(Boolean))add('ACK_UTILTS_MESSAGE_FUNCTION_INVALID','UTILTS-APERAK meddelandefunktion ska vara 9 och kvittensbegäran ska utelämnas.','BGM/A204')
 }else{
  if(!CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.allowedFunctions.includes(value(wire,bgm,3)))add('ACK_PRODAT_MESSAGE_FUNCTION_INVALID','PRODAT-APERAK meddelandefunktion ska vara 27 eller 34.','BGM/A204')
  // Frozen ACK-10, P16.B pp98–100: 1001/1004 are unused; 1225 is
  // the function. A technical UNH/archive identity is not a BGM document id.
  if(CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.unusedDocumentElements.some(index=>segmentComposite(bgm,index,wire.una).some(Boolean)))add('ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT','PRODAT-APERAK BGM/1001 och BGM/1004 ska utelämnas.','BGM/1001/1004')
 }
 const dates=all('DTM').filter(t=>value(wire,t,1)===CANONICAL_ACK_GUIDE_CONSTRAINTS.common.documentDate.qualifier)
 if(dates.length!==1||segmentComposite(dates[0],1,wire.una)[2]!==CANONICAL_ACK_GUIDE_CONSTRAINTS.common.documentDate.format||!dateTime(segmentComposite(dates[0],1,wire.una)[1]??''))add('ACK_APERAK_DOCUMENT_DATE_INVALID','APERAK ska innehålla ett giltigt eget meddelandedatum.','DTM/A205')
 if(utilts){const offsets=all('DTM').filter(t=>value(wire,t,1)==='735');if(offsets.length!==1||!equal(segmentComposite(offsets[0],1,wire.una),CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.fixedOffset))add('ACK_UTILTS_TIME_OFFSET_INVALID','UTILTS-APERAK ska ange den svenska fasta tidszonen.','DTM/A206')}
 const firstError=segments.findIndex(t=>t.tag==='ERC'),header=firstError<0?segments:segments.slice(0,firstError)
 for(const qualifier of utilts?['MS','MR']:['FR','DO']){
  const parties=header.filter(t=>t.tag==='NAD'&&value(wire,t,1)===qualifier),party=segmentComposite(parties[0],2,wire.una)
  const qualifiersValid=utilts?CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.legalAgencies.includes(party[2]??'')&&(party[2]!==CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.svkAgency||party[1]===CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.svkQualifier):party[1]===CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.legalQualifier&&party[2]===CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.legalAgency&&new RegExp(CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.countryPattern).test(value(wire,parties[0],9))
  if(parties.length!==1||!party[0]||party[0].length>35||!qualifiersValid)add('ACK_APERAK_LEGAL_PARTY_INVALID','Kvittensen ska identifiera sin juridiska avsändare och mottagare separat från transporten.','NAD/A207/A208')
 }
 const groups=segments.flatMap((t,index)=>t.tag==='ERC'?[segments.slice(index,segments.findIndex((next,nextIndex)=>nextIndex>index&&['ERC','UNT','UNZ'].includes(next.tag))<0?segments.length:segments.findIndex((next,nextIndex)=>nextIndex>index&&['ERC','UNT','UNZ'].includes(next.tag)))]:[])
 if(!groups.length)add('ACK_APERAK_ERROR_GROUP_MISSING','APERAK ska ha minst en egen ERC/FTX-grupp.','ERC/A902')
 const documentStatus=value(wire,bgm,1),functionCode=value(wire,bgm,3),ownDm:string[]=[],acknowledged:string[]=[]
 for(const group of groups){
  const erc=segmentComposite(group[0],1,wire.una),code=erc[0]??'',positive=code==='100'
  if(!constraints.allowedErc.includes(code)||erc[1]||erc[2]!==constraints.agency||erc.slice(3).some(Boolean))add('ACK_APERAK_ACCEPTANCE_CODE_INVALID','ERC ska ange en tillåten kod och rätt kodlistansvarig.','ERC/A902')
  if(utilts&&((documentStatus==='312'&&!positive)||(documentStatus==='313'&&positive)))add('ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT','UTILTS-APERAK får inte blanda godkända och avvisade transaktioner eller motsäga BGM.','BGM/ERC')
  if(!utilts&&functionCode==='27'&&positive)add('ACK_PRODAT_WHOLE_REJECTION_ACCEPTANCE_CONFLICT','Ett helt avvisat PRODAT får inte innehålla ERC100.','BGM/ERC')
  const texts=group.filter(t=>t.tag==='FTX'),ftx=texts[0],literal=segmentComposite(ftx,4,wire.una),ref=segmentComposite(ftx,3,wire.una)
  if(texts.length!==1||group[1]?.tag!=='FTX'||value(wire,ftx,1)!==constraints.textQualifier||segmentComposite(ftx,2,wire.una).some(Boolean)||!literal[0]||Array.from(literal[0]).length>constraints.textMax||literal.slice(1).some(Boolean)||[5,6].some(index=>segmentComposite(ftx,index,wire.una).some(Boolean)))add('ACK_APERAK_OWN_TEXT_INVALID','Varje ERC ska följas av en egen tillåten FTX-text utan språk eller extra textkomponenter.','FTX/A905')
  if(positive){if(literal[0]!==CANONICAL_ACK_GUIDE_CONSTRAINTS.common.positiveText||ref.some(Boolean))add('ACK_APERAK_POSITIVE_TEXT_INVALID','ERC100 ska ha exakt OK utan felreferens.','FTX/A905')}
  else {
   if(!ref[0]||ref[0].length>constraints.fieldReferenceMax||ref[1]||ref[2]!=='260'||ref.slice(3).some(Boolean))add('ACK_APERAK_FIELD_REFERENCE_INVALID','Negativ ERC ska peka på sin egen source-kvalificerade felreferens.','FTX/A903/A904')
   if(!utilts&&['41','42'].includes(code)&&!CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.fieldLabels[ref[0]??''])add('ACK_PRODAT_FIELD_REFERENCE_UNKNOWN','A904 ska referera ett PRODAT-fältnummer.','FTX/A904')
   if(!utilts&&code==='40'&&(!CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.applicationTexts[ref[0]??'']||literal[0]!==CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.applicationTexts[ref[0]??'']))add('ACK_PRODAT_APPLICATION_TEXT_INVALID','A903/A905 ska ange det föreskrivna PRODAT-applikationsfelet.','FTX/A903/A905')
   const label=prodatAperakFieldWireLabel(ref[0]??'')
   if(!utilts&&code==='41'&&label&&literal[0]!==`${label}${CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.missingSuffix}`&&!literal[0]?.startsWith(`${label}${CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.missingCustomerPrefix}`))add('ACK_PRODAT_MISSING_TEXT_INVALID','ERC41 ska använda det svenska fältnamnet och föreskriven beskrivning.','FTX/A905')
   if(!utilts&&code==='42'&&label&&(!literal[0]?.startsWith(`${CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.invalidPrefix}${label} `)||literal[0].length<=`${CANONICAL_ACK_GUIDE_CONSTRAINTS.PRODAT.invalidPrefix}${label} `.length))add('ACK_PRODAT_INVALID_TEXT_INVALID','ERC42 ska använda det svenska fältnamnet och felaktigt mottaget innehåll.','FTX/A905')
   if(utilts&&code==='41'&&literal[0]!==CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.missingText)add('ACK_UTILTS_MISSING_TEXT_INVALID','ERC41 ska ange den föreskrivna beskrivningen.','FTX/A905')
   if(utilts&&code==='42'&&!new RegExp(CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.invalidTextPattern).test(literal[0]??''))add('ACK_UTILTS_INVALID_TEXT_INVALID','ERC42 ska beskriva det felaktiga mottagna innehållet.','FTX/A905')
  }
  if(utilts){
   const dm=references(wire,group,'DM'),acw=references(wire,group,'ACW');ownDm.push(...dm);acknowledged.push(...acw)
   if(!one(dm)||dm[0].length>CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.ownDmMax)add('ACK_UTILTS_OWN_TRANSACTION_ID_INVALID','Varje APERAK-transaktion ska ha sitt eget DM-id.','RFF/A906')
   if(acw.length>1||acw.some(ref=>!ref||ref.length>CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.originalAcwMax)||(positive&&acw.length!==1))add('ACK_UTILTS_ORIGINAL_TRANSACTION_INVALID','Varje transaktion ska kopiera sin egen ACW-referens när den är tillgänglig.','RFF/A505')
  }else{
   const li=references(wire,group,'LI'),object=references(wire,group,'Z07');acknowledged.push(...li)
   if(li.length>1||li.some(ref=>!ref||ref.length>35)||object.length>1||object.some(ref=>!ref||ref.length>25)||(positive&&li.length!==1))add('ACK_PRODAT_OWN_OBJECT_REFERENCE_INVALID','Varje ERC ska bära en entydig egen objekt-/ärendereferens enligt ursprunget.','RFF/A209/A226')
  }
 }
 if(utilts){
  if(new Set(ownDm).size!==ownDm.length)add('ACK_UTILTS_OWN_TRANSACTION_ID_DUPLICATE','APERAK-transaktionsnummer ska vara unika i meddelandet.','RFF/A906')
  const docs=all('DOC');if(docs.length>1)add('ACK_UTILTS_ORIGINAL_DOCUMENT_AMBIGUOUS','DOC får inte peka på flera ursprungsmeddelanden.','DOC/A503/A504')
 }else if(!one(references(wire,header,'ACW')))add('ACK_PRODAT_ORIGINAL_DOCUMENT_INVALID','PRODAT-APERAK ska referera ett eget ursprungligt PRODAT-meddelande.','RFF/A255')
 if(input.sourceRawPayload){
  const source=tokenizeEdifact(input.sourceRawPayload),sourceBgm=source.segments.find(t=>t.tag==='BGM'),sourceHeader=source.segments.slice(0,source.segments.findIndex(t=>['LIN','IDE','ERC'].includes(t.tag))<0?source.segments.length:source.segments.findIndex(t=>['LIN','IDE','ERC'].includes(t.tag)))
  const sourceType=segmentComposite(source.segments.find(t=>t.tag==='UNH'),2,source.una)[0]
  if(sourceType!==(utilts?'UTILTS':'PRODAT'))add('ACK_SOURCE_FAMILY_MISMATCH','Kvittensen måste tillhöra det faktiska ursprungets familj.','UNH')
  if(utilts){
   const doc=all('DOC')[0];if(value(wire,doc,1)!==value(source,sourceBgm,1)||value(wire,doc,2)!==value(source,sourceBgm,2))add('ACK_UTILTS_ORIGINAL_DOCUMENT_MISMATCH','DOC ska kopiera känt ursprungligt BGM.','DOC/A503/A504')
   const originalIds=source.segments.filter(t=>t.tag==='IDE').map(t=>value(source,t,2));if(acknowledged.some(ref=>!originalIds.includes(ref)))add('ACK_UTILTS_ORIGINAL_TRANSACTION_MISMATCH','ACW ska avse sin egen verkliga ursprungstransaktion.','RFF/A505')
  }else{
   if(one(references(wire,header,'ACW'))!==value(source,sourceBgm,2))add('ACK_PRODAT_ORIGINAL_DOCUMENT_MISMATCH','ACW ska kopiera ursprungligt BGM/1004.','RFF/A255')
   const objects=prodatRegisterGroups(source.segments,source.una,value(source,sourceBgm,1)).groups.filter(object=>object.registerPosition===1)
   // P pp85–87, authenticated original relevant-page excerpt, permits replies
   // per own installation in multiple APERAK messages.
   // Native immutable own response receipts qualify each actual final scope;
   // siblings omitted from this wire cannot be inferred accepted or rejected.
   const outcomes=new Map<number,boolean>()
   for(const group of groups){
    const li=one(references(wire,group,'LI')),objectId=one(references(wire,group,'Z07')),matches=objects.filter(object=>li?references(source,object.segments,'LI').includes(li):objectId?value(source,object.segments[0],3)===objectId:false)
    if(functionCode==='27'&&!li&&!objectId)continue
    if(matches.length!==1){add('ACK_PRODAT_OWN_OBJECT_SCOPE_MISMATCH','ERC ska avse en entydig egen anläggning i ursprungsmeddelandet.','RFF/A209/A226');continue}
    const original=matches[0],physicalId=segmentComposite(original.segments[0],3,source.una)[0]??'',originalLi=one(references(source,original.segments,'LI'))
    if(originalLi!==li||(physicalId&&objectId!==physicalId&&!(value(wire,group[0],1)==='100'&&value(source,sourceBgm,1)==='Z13')))add('ACK_PRODAT_OWN_OBJECT_REFERENCE_MISMATCH','Kända ursprungliga objekt- och ärendereferenser ska kopieras utan syskonbyte.','RFF/A209/A226')
    const positive=value(wire,group[0],1)==='100',prior=outcomes.get(original.lineIndex)
    if(prior!==undefined&&prior!==positive)add('ACK_PRODAT_OWN_OBJECT_OUTCOME_CONFLICT','Samma ursprungliga anläggning får inte samtidigt godkännas och avvisas.','ERC')
    outcomes.set(original.lineIndex,positive)
   }
  }
  for(const [own,opposite] of utilts?[['MS','MR'],['MR','MS']]:[['FR','DO'],['DO','FR']]){
   const original=sourceHeader.filter(t=>t.tag==='NAD'&&value(source,t,1)===opposite),actual=header.filter(t=>t.tag==='NAD'&&value(wire,t,1)===own)
   if(original.length!==1||actual.length!==1||!equal(segmentComposite(original[0],2,source.una),segmentComposite(actual[0],2,wire.una))||(!utilts&&value(source,original[0],9)!==value(wire,actual[0],9)))add('ACK_APERAK_ORIGINAL_LEGAL_PARTY_MISMATCH','Juridiska kvittensparter ska spegla originalets verifierade egna parter och kvalifikatorer.','NAD/A207/A208')
  }
  if(utilts){
   const subordinate=(w:Wire,tokens:readonly EdifactTokenizedSegment[])=>tokens.filter(t=>t.tag==='NAD'&&!['MS','MR'].includes(value(w,t,1))&&!segmentComposite(t,2,w.una).some(Boolean)).map(t=>value(w,t,1)).sort()
   if(!equal(subordinate(source,sourceHeader),subordinate(wire,header)))add('ACK_UTILTS_ORIGINAL_SUBORDINATE_ROLE_MISMATCH','Kvittensen ska behålla originalets faktiskt angivna underordnade roll.','NAD/A509')
  }
 }
 return issues
}
