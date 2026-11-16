'use strict';
// Fresh declared synthetic negative sources only. Never a positive source issuer.
// Generation happens after the real normal receiver receipt/native ACK; no old
// wire, date, source UUID or idempotency key is renamed as this cohort.
const crypto=require('node:crypto');
const CASES=['WRONG_PARTY','SMTP_451','SMTP_550','SMTP_DROP_DATA'];
const need=(v,m)=>{if(!v)throw Error(m)},H=b=>crypto.createHash('sha256').update(b).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function scalar(s){need(typeof s==='string'&&/^[\x20-\x7e]*$/.test(s),'ASCII_DECLARED_WIRE_VALUE');return s.replace(/[?:+']/g,c=>'?'+c)}
const segment=p=>p.map(x=>Array.isArray(x)?x.map(scalar).join(':'):scalar(x)).join('+');
function prodatMissing202(c,x,now){
 const stamp=now.toISOString().replace(/[-:]/g,'').slice(0,13).replace('T','');
 const doc='F4'+String(CASES.indexOf(x.caseName))+c.cohortId.replaceAll('-','').slice(0,20);
 const msg=doc.slice(0,14),interchange=doc.slice(0,13);
 // Original guide-ordered header-negative fixture, with all S/R/date/I/M/D
 // literals replaced before source creation. BGM field202 is the only declared
 // common-header omission; document/APP/ordered LIN/Z13/Z25 remain physical.
 const body=[['NAD','FR',[x.senderEdielId,'160','SVK'],'','','','','','','SE'],
  ['NAD','DO',['99003','160','SVK'],'','','','','','','SE'],
  ['LIN','1','',[c.meteringPointEdielId,'','','9']],['CCI','','Z13'],['CAV',['Z25']],
  ['RFF',['LI',doc]],['NAD','UD',['5561234567','SE1','260'],'','Synthetic owned negative','Fixture street','Fixture town','','12345','SE']];
 const parts=[['UNH',msg,['PRODAT','D','97A','UN','E2SE6A']],['BGM','',doc,'9','AB'],
  ['DTM',['137',stamp,'203']],['DTM',['ZZZ','1','805']],...body];
 parts.push(['UNT',String(parts.length+1),msg]);
 return "UNA:+.? '"+[
  ['UNB',['UNOC','3'],[x.senderEdielId,'14'],['99003','14'],[stamp.slice(2,8),stamp.slice(8,12)],interchange,'','23-DDQ-PRODAT','','1','','1'],
  ...parts,['UNZ','1',interchange],
 ].map(segment).join("'")+"'";
}
function mime(raw,c,x,now){
 need(/^[a-z0-9.-]+@fixture\.invalid$/.test(x.fromEmail)&&/^[a-z0-9.-]+@fixture\.invalid$/.test(c.inboundEmail),'ONLY_CLOSED_SYNTHETIC_MAIL_ADDRESSES');
 need(!/[\r\n]/.test(x.caseName)&&/^[\x00-\x7f]*$/.test(raw),'ASCII_WIRE_NO_LOSSY_MIME');
 const id='<four-'+c.cohortId+'-'+x.caseName.toLowerCase()+'@fixture.invalid>';
 return Buffer.from(['From: '+x.fromEmail,'To: '+c.inboundEmail,'Date: '+now.toUTCString(),
  'Message-ID: '+id,'Subject: Declared original '+x.caseName,'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=us-ascii','Content-Transfer-Encoding: 7bit','',''+raw,''].join('\r\n'),'ascii');
}
async function make(c,modules){
 const now=new Date(),r=c.receiverReceipt;
 need(c.state==='ACTUAL_RECEIVER_BOUND_FOUR_NEGATIVE_PAYLOAD_CONFIG'&&uuid(c.cohortId)&&r?.receiverEdielId==='99003'&&r.roleCode==='electricity_supplier'&&r.assurance==='LOCAL_SIMULATION_ONLY'&&r.status==='issued'&&uuid(r.registrationId),'GENUINE_RECEIVER_RETURN_REQUIRED_BEFORE_NEW_FIXTURE');
 need(Date.parse(r.validFrom)<=now.getTime()&&Date.parse(r.validUntil)>now.getTime()+1800000,'CURRENT_REAL_RECEIVER_COVERS_COHORT');
 need(/^\d{18}$/.test(c.meteringPointEdielId)&&Array.isArray(c.cases)&&c.cases.length===4&&c.cases.every((x,i)=>x.caseName===CASES[i]&&/^\d{5}$/.test(x.senderEdielId)&&x.senderEdielId!=='99003'),'EXACT_FOUR_NEW_SOURCES');
 need(new Set(c.cases.map(x=>x.senderEdielId)).size===4,'DISTINCT_DECLARED_SOURCE_PARTIES');
 const results=[];
 for(const x of c.cases){
  let raw;
  if(x.caseName==='WRONG_PARTY'){
   // Uses the unchanged normal formatter and its real current version reader.
   // No generated draft is persisted or presented as a positive native issuer.
   const end=new Date(Math.floor(now.getTime()/900000)*900000),start=new Date(end.getTime()-900000);
   const draft=await modules.utilts.buildUtiltsOutboundDraft({actorUserId:c.actorId,code:'E66',environment:'test',
    senderEdielId:x.senderEdielId,receiverEdielId:'99003',applicationReference:'23-DDQ-E66-S',
    externalReference:'F4'+c.cohortId.replaceAll('-','').slice(0,20),transactionReference:'F4TX'+c.cohortId.replaceAll('-','').slice(0,20),
    payload:{legalSenderEdielId:x.senderEdielId,legalReceiverEdielId:'99003',meterPointId:c.meteringPointEdielId,
     gridAreaId:'TES',periodStart:start.toISOString(),periodEnd:end.toISOString(),registrationTime:now.toISOString(),
     quantity:5,unit:'KWH',productId:'8716867000030',siteType:'Consumption'}});
   raw=draft.rawPayload;need(typeof raw==='string'&&raw.length>0,'NORMAL_UTILTS_FORMATTER_REQUIRED');
  }else raw=prodatMissing202(c,x,now);
  const grammar=modules.grammar.validateUnsmGrammar(raw);need(grammar.qualification==='qualified'&&grammar.syntaxOk===true,'ACTUAL_FULL_RAW_GRAMMAR_REQUIRED');
  const parsed=modules.parser.parseInboundEmailContent({bodyText:raw});need(parsed?.rawPayload===raw,'NORMAL_LOSSLESS_SOURCE_PARSE');
  if(x.caseName==='WRONG_PARTY')need(parsed.messageFamily==='UTILTS'&&parsed.messageCode==='E66','NORMAL_UNKNOWN_PARTY_UTILTS_E66_SOURCE');
  else need(parsed.messageFamily==='PRODAT'&&parsed.messageCode==='PRODAT_UNKNOWN'&&modules.headerNegative.observeAssignedProdatHeaderNegativeField(raw)==='202','ONLY_ASSIGNED_MISSING_202_NEGATIVE');
  const wire=Buffer.from(raw,'utf8'),rawMime=mime(raw,c,x,now);
  results.push({caseName:x.caseName,rawPayload:raw,rawPayloadSHA256:H(wire),rawPayloadBytes:wire.length,
   rawMime,rawMimeSHA256:H(rawMime),rawMimeBytes:rawMime.length,physicalEncoding:'ASCII/7bit',
   generatedAt:now.toISOString(),normalParsed:{messageFamily:parsed.messageFamily,messageCode:parsed.messageCode},
   fullGrammarQualified:true,declaredNegativeOnly:true,receiverRegistrationId:r.registrationId});
 }
 need(new Set(results.map(x=>x.rawPayloadSHA256)).size===4&&new Set(results.map(x=>x.rawMimeSHA256)).size===4,'FOUR_DISTINCT_IMMUTABLE_SOURCE_BYTES');return results;
}
module.exports={CASES,scalar,segment,prodatMissing202,mime,make};
