import {tokenizeEdifact,segmentComposite,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {CanonicalEdielPolicy} from './canonicalEdielPolicy'
import type {EdielRulebookIssue} from './rulebook'
import {PRODAT_APERAK_FIELD_NAMES,PRODAT_APERAK_APPLICATION_TEXTS,prodatAperakFieldWireLabel} from '@/lib/ediel/prodat/prodatAperakText'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'

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
export function validateCanonicalAckGuide(input:{policy:CanonicalEdielPolicy;rawSegments?:readonly string[]|null;una?:EdifactServiceStringAdvice;sourceRawPayload?:string|null}):EdielRulebookIssue[]{
 if(!['CONTRL','APERAK','UTILTS_ERR'].includes(input.policy.family))return []
 const una=input.una??parseUna(null),wire=tokenizeEdifact(`${una.raw}${(input.rawSegments??[]).join(una.segmentTerminator)}${una.segmentTerminator}`),issues:EdielRulebookIssue[]=[]
 const add=(code:string,description:string,fieldPath?:string)=>issues.push({code,severity:'error',blocking:true,title:'Nationell kvittensanvisning',description,fieldPath})
 const segments=wire.segments,all=(tag:string)=>segments.filter(t=>t.tag===tag),type=segmentComposite(all('UNH')[0],2,wire.una)
 if(all('UNH').length!==1)add('ACK_GUIDE_ONE_MESSAGE_REQUIRED','Kvittensen ska avse ett eget fysiskt meddelande.','UNH')
 if(input.sourceRawPayload){
  const source=tokenizeEdifact(input.sourceRawPayload),originals=source.segments.filter(t=>t.tag==='UNB'),original=originals[0],outgoing=all('UNB')[0]
  if(originals.length!==1||all('UNB').length!==1
   ||!equal(segmentComposite(outgoing,2,wire.una),segmentComposite(original,3,source.una))
   ||!equal(segmentComposite(outgoing,3,wire.una),segmentComposite(original,2,source.una))
   ||!equal(segmentComposite(outgoing,7,wire.una),segmentComposite(original,7,source.una))
   ||!equal(segmentComposite(outgoing,11,wire.una),segmentComposite(original,11,source.una)))add('ACK_ORIGINAL_TECHNICAL_ROUTE_MISMATCH','Kvittensens tekniska UNB-parter, application reference och miljö ska spegla det faktiska originalet.','UNB')
  if(input.policy.family==='UTILTS_ERR'&&value(source,source.segments.find(t=>t.tag==='UNH'),2)!=='UTILTS')add('ACK_SOURCE_FAMILY_MISMATCH','UTILTS-ERR måste tillhöra ett verkligt UTILTS-ursprung.','UNH')
 }
 if(input.policy.family==='UTILTS_ERR')return issues // ERR guide fields remain in the one UTILTS owner.
 if(input.policy.family==='CONTRL'){
  if(!equal(type.slice(0,4),['CONTRL','2','2','UN'])||(type[4]&&type[4]!=='EDIEL2')||type.slice(5).some(Boolean))add('ACK_CONTRL_PROFILE_INVALID','CONTRL ska använda den svenska tekniska profilen.','UNH/S009')
  for(const tag of ['BGM','DOC','ERC','FTX','RFF','NAD'])if(all(tag).length)add('ACK_CONTRL_NATIONAL_SEGMENT_FORBIDDEN',`CONTRL får inte innehålla ${tag} från applikationskvittensen.`,tag)
  const uci=all('UCI'),control=segmentComposite(uci[0],1,wire.una)
  if(uci.length!==1||control.length!==1||!control[0]||control[0].length>14)add('ACK_CONTRL_ORIGINAL_REFERENCE_INVALID','UCI ska kopiera ett entydigt ursprungligt överföringsnummer.','UCI/0020')
  if(!['1','4'].includes(value(wire,uci[0],4)))add('ACK_CONTRL_ACTION_INVALID','UCI/0083 ska vara 1 eller 4.','UCI/0083')
  for(const index of [2,3])if(!segmentComposite(uci[0],index,wire.una)[0])add('ACK_CONTRL_ORIGINAL_PARTY_MISSING','UCI ska innehålla originalets tekniska parter.','UCI')
  if(input.sourceRawPayload){
   const source=tokenizeEdifact(input.sourceRawPayload),original=source.segments.find(t=>t.tag==='UNB')
   if(source.segments.some(t=>t.tag==='UNH'&&value(source,t,2)==='CONTRL')||value(wire,uci[0],1)!==value(source,original,5)
     ||!equal(segmentComposite(uci[0],2,wire.una),segmentComposite(original,2,source.una))||!equal(segmentComposite(uci[0],3,wire.una),segmentComposite(original,3,source.una)))add('ACK_CONTRL_ORIGINAL_SCOPE_MISMATCH','UCI ska kopiera det faktiska originalets överföring och tekniska parter.','UCI')
  }
  return issues
 }
 const utilts=input.policy.guide.documentName.includes('UTILTS'),release=utilts?'04A':'96A'
 if(utilts&&[2,3].some(index=>segmentComposite(all('UNB')[0],index,wire.una)[2]==='PRODAT'))add('ACK_UTILTS_PRODAT_SUBADDRESS_FORBIDDEN','UTILTS-APERAK får inte använda PRODAT-subadress.','UNB')
 if(!equal(type,['APERAK','D',release,'UN',input.policy.associationAssignedCode??'']))add('ACK_APERAK_PROFILE_INVALID','APERAK ska följa den redan valda ursprungsfamiljens tekniska profil.','UNH/S009')
 const bgms=all('BGM'),bgm=bgms[0]
 if(bgms.length!==1)add('ACK_APERAK_BGM_CARDINALITY','APERAK ska ha ett BGM.','BGM')
 if(utilts){
  if(!['312','313'].includes(value(wire,bgm,1))||segmentComposite(bgm,1,wire.una).slice(1).some(Boolean))add('ACK_UTILTS_BGM_STATUS_INVALID','UTILTS-APERAK BGM ska vara 312 eller 313.','BGM/A202')
  const id=segmentComposite(bgm,2,wire.una)
  if(!id[0]||id[0].length>35||id.slice(1).some(Boolean))add('ACK_UTILTS_DOCUMENT_ID_INVALID','APERAK ska ha sitt eget oförändrade meddelande-id.','BGM/A203')
  if(value(wire,bgm,3)!=='9'||segmentComposite(bgm,4,wire.una).some(Boolean))add('ACK_UTILTS_MESSAGE_FUNCTION_INVALID','UTILTS-APERAK meddelandefunktion ska vara 9 och kvittensbegäran ska utelämnas.','BGM/A204')
 }else if(!['27','34'].includes(value(wire,bgm,3)))add('ACK_PRODAT_MESSAGE_FUNCTION_INVALID','PRODAT-APERAK meddelandefunktion ska vara 27 eller 34.','BGM/A204')
 const dates=all('DTM').filter(t=>value(wire,t,1)==='137')
 if(dates.length!==1||segmentComposite(dates[0],1,wire.una)[2]!=='203'||!dateTime(segmentComposite(dates[0],1,wire.una)[1]??''))add('ACK_APERAK_DOCUMENT_DATE_INVALID','APERAK ska innehålla ett giltigt eget meddelandedatum.','DTM/A205')
 if(utilts){const offsets=all('DTM').filter(t=>value(wire,t,1)==='735');if(offsets.length!==1||!equal(segmentComposite(offsets[0],1,wire.una),['735','+0100','406']))add('ACK_UTILTS_TIME_OFFSET_INVALID','UTILTS-APERAK ska ange den svenska fasta tidszonen.','DTM/A206')}
 const firstError=segments.findIndex(t=>t.tag==='ERC'),header=firstError<0?segments:segments.slice(0,firstError)
 for(const qualifier of utilts?['MS','MR']:['FR','DO']){
  const parties=header.filter(t=>t.tag==='NAD'&&value(wire,t,1)===qualifier),party=segmentComposite(parties[0],2,wire.una)
  const qualifiersValid=utilts?['260','9','305'].includes(party[2]??'')&&(party[2]!=='260'||party[1]==='SVK'):party[1]==='160'&&party[2]==='SVK'&&/^[A-Z]{2}$/.test(value(wire,parties[0],9))
  if(parties.length!==1||!party[0]||party[0].length>35||!qualifiersValid)add('ACK_APERAK_LEGAL_PARTY_INVALID','Kvittensen ska identifiera sin juridiska avsändare och mottagare separat från transporten.','NAD/A207/A208')
 }
 const groups=segments.flatMap((t,index)=>t.tag==='ERC'?[segments.slice(index,segments.findIndex((next,nextIndex)=>nextIndex>index&&['ERC','UNT','UNZ'].includes(next.tag))<0?segments.length:segments.findIndex((next,nextIndex)=>nextIndex>index&&['ERC','UNT','UNZ'].includes(next.tag)))]:[])
 if(!groups.length)add('ACK_APERAK_ERROR_GROUP_MISSING','APERAK ska ha minst en egen ERC/FTX-grupp.','ERC/A902')
 const documentStatus=value(wire,bgm,1),functionCode=value(wire,bgm,3),ownDm:string[]=[],acknowledged:string[]=[]
 for(const group of groups){
  const erc=segmentComposite(group[0],1,wire.una),code=erc[0]??'',positive=code==='100'
  if(!(utilts?['100','41','42']:['100','40','41','42']).includes(code)||erc[1]||erc[2]!=='260'||erc.slice(3).some(Boolean))add('ACK_APERAK_ACCEPTANCE_CODE_INVALID','ERC ska ange en tillåten kod och rätt kodlistansvarig.','ERC/A902')
  if(utilts&&((documentStatus==='312'&&!positive)||(documentStatus==='313'&&positive)))add('ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT','UTILTS-APERAK får inte blanda godkända och avvisade transaktioner eller motsäga BGM.','BGM/ERC')
  if(!utilts&&functionCode==='27'&&positive)add('ACK_PRODAT_WHOLE_REJECTION_ACCEPTANCE_CONFLICT','Ett helt avvisat PRODAT får inte innehålla ERC100.','BGM/ERC')
  const texts=group.filter(t=>t.tag==='FTX'),ftx=texts[0],literal=segmentComposite(ftx,4,wire.una),ref=segmentComposite(ftx,3,wire.una)
  if(texts.length!==1||group[1]?.tag!=='FTX'||value(wire,ftx,1)!=='AAO'||segmentComposite(ftx,2,wire.una).some(Boolean)||!literal[0]||Array.from(literal[0]).length>(utilts?512:70)||literal.slice(1).some(Boolean)||[5,6].some(index=>segmentComposite(ftx,index,wire.una).some(Boolean)))add('ACK_APERAK_OWN_TEXT_INVALID','Varje ERC ska följas av en egen tillåten FTX-text utan språk eller extra textkomponenter.','FTX/A905')
  if(positive){if(literal[0]!=='OK'||ref.some(Boolean))add('ACK_APERAK_POSITIVE_TEXT_INVALID','ERC100 ska ha exakt OK utan felreferens.','FTX/A905')}
  else {
   if(!ref[0]||ref[0].length>(utilts?17:3)||ref[1]||ref[2]!=='260'||ref.slice(3).some(Boolean))add('ACK_APERAK_FIELD_REFERENCE_INVALID','Negativ ERC ska peka på sin egen source-kvalificerade felreferens.','FTX/A903/A904')
   if(!utilts&&['41','42'].includes(code)&&!PRODAT_APERAK_FIELD_NAMES[ref[0]??''])add('ACK_PRODAT_FIELD_REFERENCE_UNKNOWN','A904 ska referera ett PRODAT-fältnummer.','FTX/A904')
   if(!utilts&&code==='40'&&(!PRODAT_APERAK_APPLICATION_TEXTS[ref[0]??'']||literal[0]!==PRODAT_APERAK_APPLICATION_TEXTS[ref[0]??'']))add('ACK_PRODAT_APPLICATION_TEXT_INVALID','A903/A905 ska ange det föreskrivna PRODAT-applikationsfelet.','FTX/A903/A905')
   const label=prodatAperakFieldWireLabel(ref[0]??'')
   if(!utilts&&code==='41'&&label&&literal[0]!==`${label} saknas`&&!literal[0]?.startsWith(`${label} saknas, kundid`))add('ACK_PRODAT_MISSING_TEXT_INVALID','ERC41 ska använda det svenska fältnamnet och föreskriven beskrivning.','FTX/A905')
   if(!utilts&&code==='42'&&label&&(!literal[0]?.startsWith(`Felaktigt ${label} `)||literal[0].length<=`Felaktigt ${label} `.length))add('ACK_PRODAT_INVALID_TEXT_INVALID','ERC42 ska använda det svenska fältnamnet och felaktigt mottaget innehåll.','FTX/A905')
   if(utilts&&code==='41'&&literal[0]!=='MANDATORY FIELD MISSING')add('ACK_UTILTS_MISSING_TEXT_INVALID','ERC41 ska ange den föreskrivna beskrivningen.','FTX/A905')
   if(utilts&&code==='42'&&!/^INCORRECT DATA .+$/.test(literal[0]??''))add('ACK_UTILTS_INVALID_TEXT_INVALID','ERC42 ska beskriva det felaktiga mottagna innehållet.','FTX/A905')
  }
  if(utilts){
   const dm=references(wire,group,'DM'),acw=references(wire,group,'ACW');ownDm.push(...dm);acknowledged.push(...acw)
   if(!one(dm)||dm[0].length>70)add('ACK_UTILTS_OWN_TRANSACTION_ID_INVALID','Varje APERAK-transaktion ska ha sitt eget DM-id.','RFF/A906')
   if(acw.length>1||acw.some(ref=>!ref||ref.length>70)||(positive&&acw.length!==1))add('ACK_UTILTS_ORIGINAL_TRANSACTION_INVALID','Varje transaktion ska kopiera sin egen ACW-referens när den är tillgänglig.','RFF/A505')
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
   const answered=new Set<string>()
   for(const group of groups){
    const li=one(references(wire,group,'LI')),objectId=one(references(wire,group,'Z07')),matches=objects.filter(object=>li?references(source,object.segments,'LI').includes(li):objectId?value(source,object.segments[0],3)===objectId:false)
    if(functionCode==='27'&&!li&&!objectId)continue
    if(matches.length!==1){add('ACK_PRODAT_OWN_OBJECT_SCOPE_MISMATCH','ERC ska avse en entydig egen anläggning i ursprungsmeddelandet.','RFF/A209/A226');continue}
    const original=matches[0],physicalId=segmentComposite(original.segments[0],3,source.una)[0]??'',originalLi=one(references(source,original.segments,'LI'))
    if(originalLi!==li||(physicalId&&objectId!==physicalId&&!(value(wire,group[0],1)==='100'&&value(source,sourceBgm,1)==='Z13')))add('ACK_PRODAT_OWN_OBJECT_REFERENCE_MISMATCH','Kända ursprungliga objekt- och ärendereferenser ska kopieras utan syskonbyte.','RFF/A209/A226')
    answered.add(String(original.lineIndex))
   }
   if(functionCode==='34'&&objects.some(object=>!answered.has(String(object.lineIndex))))add('ACK_PRODAT_OBJECT_OUTCOME_MISSING','Ett bearbetat PRODAT ska besvaras för varje egen anläggning i samma APERAK.','ERC')
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
