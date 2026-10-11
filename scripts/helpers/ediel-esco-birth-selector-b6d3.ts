// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Actual prospective transport and public intake; no registered tests, hooks,
// private profile, accepted assessment or domain authority is constructed here.
import {expect,vi} from 'vitest'
import {nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal,
 type seedNativeEscoFixture,type prepareNativeEscoPermissionFixture} from '../fixtures/ediel-service-evidence-native'
import {omitPermissionField} from './ediel-permission-field-omissions'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {createHash} from 'node:crypto'

type Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>
type Pending=Awaited<ReturnType<typeof prepareNativeEscoPermissionFixture>>
type Row=Record<string,unknown>
type Field='311'|'312'|'202'|'314'|'223'|'226'
type Reply='positive'|'nationalN'
type Input=Parameters<typeof createInboundEdielMessage>[0]
type Column={name:string;nullable:boolean;default:string|null}
type Wiring={accepted:(mode:'V'|'VH')=>Promise<{f:Fixture;p:Pending;checkSentinel:()=>void}>;
 render:(f:Fixture,p:Pending,reply:Reply)=>string;retained:(f:Fixture,raw:string)=>Promise<Input>;
 state:(f:Fixture)=>unknown;ledger:(f:Fixture)=>unknown;noAccess:(f:Fixture,p:Pending)=>Promise<void>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
const intakeTables=['public.ediel_mailboxes','public.inbound_email_messages',
 'public.inbound_ediel_parse_results','public.inbound_ediel_match_attempts'] as const
const protectedTables=['gridex_unattributed_intake.raw_births','gridex_unattributed_intake.parse_births',
 'gridex_unattributed_intake.attachment_births','gridex_unattributed_intake.technical_births',
 'gridex_unattributed_intake.physical_claims','gridex_ediel_inbound_receptions.technical_mailbox_births'] as const
const allRows=(table:string)=>sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r`)
const snapshot=(tables:readonly string[])=>Object.fromEntries(tables.map(t=>[t,allRows(t)]))
const columns=(table:string)=>sql<Column[]>(`SELECT jsonb_agg(jsonb_build_object('name',a.attname,'nullable',NOT a.attnotnull,
 'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
 ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=${lit(table)}::regclass AND a.attnum>0 AND NOT a.attisdropped`)
function time(value:unknown,window:readonly[number,number]){
 expect(typeof value).toBe('string');const t=Date.parse(String(value));expect(Number.isFinite(t)).toBe(true)
 expect(t).toBeGreaterThanOrEqual(window[0]);expect(t).toBeLessThanOrEqual(window[1]);return value
}
function addition(before:Row[],after:Row[]){
 for(const old of before)expect(after.find(r=>r.id===old.id)).toEqual(old)
 const added=after.filter(r=>!before.some(old=>old.id===r.id));expect(added).toHaveLength(1)
 expect(added[0].id).toMatch(uuid);return added[0]
}
// Every column derives from the producer's exact inputs or a restricted schema
// default frozen BEFORE transport preparation. Unknown defaults remain RED.
function newRow(row:Row,writers:Row,schema:Column[],window:readonly[number,number],old:Row[]){
 expect(Object.keys(row).sort()).toEqual(schema.map(c=>c.name).sort())
 expect(Object.keys(writers).every(k=>schema.some(c=>c.name===k))).toBe(true)
 const expected:Row={}
 for(const c of schema){
  if(Object.hasOwn(writers,c.name)){expected[c.name]=writers[c.name];continue}
  const d=c.default
  if(d==='gen_random_uuid()'){
   expect(c.name).toBe('id');expect(row.id).toMatch(uuid);expect(old.map(r=>r.id)).not.toContain(row.id);expected.id=row.id
  }else if(d==='now()'||d==='clock_timestamp()')expected[c.name]=time(row[c.name],window)
  else if(d==="'{}'::jsonb")expected[c.name]={}
  else if(d==="'[]'::jsonb")expected[c.name]=[]
  else if(d!==null&&['0','1','5','10','587','993'].includes(d))expected[c.name]=Number(d)
  else if(d==='false'||d==='true')expected[c.name]=d==='true'
  else if(c.name==='mailbox_type'&&d==="'shared'::text")expected[c.name]='shared'
  else if(c.name==='transport_mode'&&d==="'smtp_imap'::text")expected[c.name]='smtp_imap'
  else if(['signing_mode','encryption_mode'].includes(c.name)&&d==="'none'::text")expected[c.name]='none'
  else if(c.name==='security_status'&&d==="'not_checked'::text")expected[c.name]='not_checked'
  else if(d===null&&c.nullable)expected[c.name]=null
  else throw Error(`native_esco_birth_unreviewed_default:${c.name}:${d}`)
 }
 expect(row).toEqual(expected)
}
function omit(raw:string,field:Field,f:Fixture,p:Pending,reply:Reply){
 const original=tokenizeEdifact(raw),u=original.una,e=u.dataElementSeparator,c=u.componentDataElementSeparator
 for(const separator of [e,c,u.segmentTerminator])expect(raw.includes(u.releaseCharacter+separator)).toBe(false)
 const positions=Object.fromEntries(['UNB','UNH','BGM','LIN','UNT'].map(tag=>{
  const found=original.segments.flatMap((s,i)=>s.tag===tag?[i]:[]);expect(found).toHaveLength(1);return[tag,found[0]]
 }))
 const segments=original.segments.map(s=>s.raw)
 expect(segmentComposite(original.segments[positions.UNB],7,u)).toEqual([f.app])
 expect(segmentComposite(original.segments[positions.UNH],2,u)).toEqual(['PRODAT','D','97A','UN','E2SE6A'])
 expect(segmentComposite(original.segments[positions.BGM],1,u)).toEqual(['Z14'])
 expect(segmentComposite(original.segments[positions.LIN],1,u)).toEqual(['1'])
 const reasons=original.segments.flatMap((s,i)=>s.raw==='CCI'+e+e+'Z13'?[i]:[])
 expect(reasons).toHaveLength(1)
 expect(segments[reasons[0]+1]).toBe('CAV'+e+(reply==='nationalN'?'Z96':f.mode==='V'?'S17':'S18'))
 expect(original.segments[reasons[0]+2]?.tag).not.toBe('CAV')
 const lis=original.segments.flatMap((s,i)=>s.tag==='RFF'&&segmentComposite(s,1,u)[0]==='LI'?[i]:[])
 expect(lis).toHaveLength(1);expect(segmentComposite(original.segments[lis[0]],1,u)).toEqual(['LI',p.li])
 if(field==='223')segments.splice(reasons[0],2)
 else if(field==='226')segments.splice(lis[0],1)
 else{
  const tag=field==='311'?'UNB':field==='312'?'UNH':field==='202'?'BGM':'LIN'
  const index=field==='311'?7:field==='312'?2:1,parts=segments[positions[tag]].split(e)
  if(field==='312'){const composite=parts[index].split(c);composite[4]='';parts[index]=composite.join(c)}
  else parts[index]=''
  segments[positions[tag]]=parts.join(e)
 }
 const unh=segments.findIndex(s=>s.startsWith('UNH'+e)),unt=segments.findIndex(s=>s.startsWith('UNT'+e))
 const trailer=segments[unt].split(e);trailer[1]=String(unt-unh+1);segments[unt]=trailer.join(e)
 const rawOmitted=omitPermissionField(raw,field),actual=tokenizeEdifact(rawOmitted)
 expect(actual.una).toEqual(u);expect(actual.segments.map(s=>s.raw)).toEqual(segments)
 return rawOmitted
}

export async function refuseEscoBirthSelector(mode:'V'|'VH',reply:Reply,field:Field,w:Wiring){
 const{f,p,checkSentinel}=await w.accepted(mode)
 await w.noAccess(f,p);checkSentinel()
 expect(p.z13).toMatchObject({original_message_id:null,transaction_reference:p.li,status:'sent'})
 const raw=omit(w.render(f,p,reply),field,f,p,reply),wire=tokenizeEdifact(raw)
 const beforePreparation=w.state(f),beforeLedger=w.ledger(f),smtp=nativeEscoExternal.send.mock.calls.length
 const tablesBefore=snapshot(intakeTables),protectedBefore=snapshot(protectedTables)
 const schemas=Object.fromEntries([...intakeTables,'public.ediel_messages'].map(t=>[t,columns(t)]))
 const requestRows=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.outbound_requests r
  WHERE r.company_id=${lit(f.ids.company)} AND r.id=${lit(p.z13.outbound_request_id)}`)
 expect(requestRows).toHaveLength(1)
 // The declared external mail fixture uses postgres, not the protected service
 // intake owner. Do not change its role or manufacture technical custody.
 expect(sql(`SELECT to_jsonb(gridex_unattributed_intake.service_session_v1())`)).toBe(false)
 const prepStart=Date.now(),input=await w.retained(f,raw),prepWindow:readonly[number,number]=[prepStart,Date.now()]
 const originalInput=structuredClone(input),prepared=snapshot(intakeTables)
 expect(input).toMatchObject({companyId:f.ids.company,actorUserId:f.ids.actor,environment:'test',parsed:{rawPayload:raw,messageFamily:'PRODAT'}})
 expect(input.parsed.messageCode).toBe(field==='202'?'PRODAT_UNKNOWN':'Z14')
 expect(input.parsed.applicationReference).toBe(field==='311'?null:f.app)
 expect(input.parsed.messageTypeVersion.associationAssignedCode).toBe(field==='312'?null:'E2SE6A')
 expect(input.parsed.transactionReference).toBe('1')
 expect(input.parsed.references.LI??[]).toEqual(field==='226'?[]:[p.li])
 const references=[input.parsed.interchangeReference,field==='226'?(reply==='positive'?input.parsed.references.Z09?.[0]:null):p.li,
  input.parsed.bgmReference,'1'].filter((v):v is string=>Boolean(v))
 expect(references.every(v=>!uuid.test(v))).toBe(true)
 const refArray=`ARRAY[${references.map(lit).join(',')}]::text[]`
 const requestCandidates=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.outbound_requests r
  WHERE r.company_id=${lit(f.ids.company)} AND (r.external_reference=ANY(${refArray}) OR r.dispatch_batch_key=ANY(${refArray}))`)
 expect(requestCandidates).toEqual([])
 const messageCandidates=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r
  WHERE r.company_id=${lit(f.ids.company)} AND r.direction='outbound' AND r.message_family NOT IN('CONTRL','APERAK','UTILTS_ERR')
  AND (r.interchange_reference=ANY(${refArray}) OR r.transaction_reference=ANY(${refArray}) OR r.external_reference=ANY(${refArray})
   OR r.correlation_reference=ANY(${refArray}) OR r.original_message_id=ANY(${refArray}))`)
 expect(messageCandidates.map(r=>r.id)).toEqual(field==='226'?[]:[p.z13.id])
 const selectedKeys='id company_id source_type source_id customer_id site_id metering_point_id grid_owner_id request_type status external_reference dispatch_batch_key message_family message_code'.split(' ')
 const candidates=field==='226'?[]:[Object.fromEntries(selectedKeys.map(k=>[k,requestRows[0][k]]))]
 const match={status:field==='226'?'missing':'matched',entityType:field==='226'?null:'outbound_request',
  entityId:field==='226'?null:p.z13.outbound_request_id,confidence:field==='226'?0:0.95,
  reasons:[`Referenser testade mot outbound_requests/ediel_messages: ${references.join(', ')}`],candidates}
 expect(input.outboundMatch).toEqual(match)
 const box=addition(tablesBefore[intakeTables[0]],prepared[intakeTables[0]])
 const mail=addition(tablesBefore[intakeTables[1]],prepared[intakeTables[1]])
 const parse=addition(tablesBefore[intakeTables[2]],prepared[intakeTables[2]])
 const attempt=addition(tablesBefore[intakeTables[3]],prepared[intakeTables[3]])
 newRow(box,{company_id:f.ids.company,mailbox_name:'Synthetic original native mailbox',email_address:'esco-native@example.invalid',
  environment:'test',is_active:true,is_shared_platform_mailbox:false},schemas[intakeTables[0]],prepWindow,tablesBefore[intakeTables[0]])
 const rawEmail=`From: recipient@example.invalid\r\nTo: esco-native@example.invalid\r\nMessage-ID: <${input.inboundEmailMessageId}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${raw}`
 newRow(mail,{id:input.inboundEmailMessageId,company_id:f.ids.company,environment:'test',mailbox_id:box.id,
  internet_message_id:input.inboundEmailMessageId+'@example.invalid',received_at:time(mail.received_at,prepWindow),
  from_address:'recipient@example.invalid',to_address:'esco-native@example.invalid',raw_email:rawEmail,raw_edifact_payload:raw,
  body_text:raw,processing_status:'received',match_status:'not_checked'},schemas[intakeTables[1]],prepWindow,tablesBefore[intakeTables[1]])
 newRow(parse,{id:input.parseResultId,company_id:f.ids.company,inbound_email_message_id:input.inboundEmailMessageId,
  message_family:'PRODAT',message_code:field==='202'?'PRODAT_UNKNOWN':'Z14',interchange_reference:input.parsed.interchangeReference,
  transaction_reference:'1',sender_ediel_id:f.receiver,sender_sub_address:null,receiver_ediel_id:f.sender,receiver_sub_address:null,
  application_reference:field==='311'?null:f.app,parse_status:'parsed',parsed_payload:input.parsed,
  validation_report:{status:'parsed_by_batch_7a1_engine'},raw_payload:raw},schemas[intakeTables[2]],prepWindow,tablesBefore[intakeTables[2]])
 newRow(attempt,{company_id:f.ids.company,inbound_email_message_id:input.inboundEmailMessageId,parse_result_id:input.parseResultId,
  match_type:'outbound_request',match_status:match.status,matched_entity_type:match.entityType,matched_entity_id:match.entityId,
  confidence:match.confidence,reasons:match.reasons,candidates:match.candidates},schemas[intakeTables[3]],prepWindow,tablesBefore[intakeTables[3]])
 expect(mail.id).toBe(input.inboundEmailMessageId);expect(parse.id).toBe(input.parseResultId)
 expect(hash(String(mail.raw_edifact_payload))).toBe(hash(raw))
 expect(w.state(f)).toEqual(beforePreparation);expect(w.ledger(f)).toEqual(beforeLedger)
 expect(snapshot(protectedTables)).toEqual(protectedBefore)
 // No collision may turn either NULL invocation into an existing reception.
 expect(sql(`SELECT count(*)::integer FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND direction='inbound'
  AND (inbound_email_message_id=${lit(input.inboundEmailMessageId)} OR interchange_reference=${lit(input.parsed.interchangeReference)})`)).toBe(0)
 const storedCode=field==='202'?'PRODAT_UNKNOWN':'Z14'
 const date=sql<string>(`SELECT to_jsonb(received_at::date) FROM public.inbound_email_messages WHERE id=${lit(input.inboundEmailMessageId)}`)
 expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
 const catalog=()=>sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('profile',to_jsonb(mp),'pack',to_jsonb(rp)) ORDER BY mp.id),'[]')
  FROM public.ediel_message_profiles mp JOIN public.ediel_rule_packs rp ON rp.id=mp.rule_pack_id
  WHERE mp.is_enabled=true AND mp.profile->>'family'='PRODAT' AND mp.message_code=${lit(storedCode)}
  AND mp.direction IN('inbound','both') AND rp.status IN('active','future') AND rp.valid_from<=${lit(date)}::date
  AND (rp.valid_to IS NULL OR rp.valid_to>=${lit(date)}::date)`)
 const catalogBefore=catalog();expect(catalogBefore.length).not.toBe(1)
 if(field==='202')expect(catalogBefore).toEqual([])
 const warning=['[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message',
  {code:'23514',message:`canonical_inbound_rule_profile_resolution_failed:PRODAT:${storedCode}:${date}:${catalogBefore.length}`,details:null,hint:null}]
 for(let invocation=0;invocation<2;invocation++){
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
  try{expect(await createInboundEdielMessage(input)).toBeNull();expect(warn.mock.calls).toEqual([warning])}
  finally{warn.mockRestore()}
  expect(input).toEqual(originalInput);expect(snapshot(intakeTables)).toEqual(prepared)
  expect(snapshot(protectedTables)).toEqual(protectedBefore)
  expect(w.state(f)).toEqual(beforePreparation);expect(w.ledger(f)).toEqual(beforeLedger)
  expect(catalog()).toEqual(catalogBefore)
  for(const table of Object.keys(schemas))expect(columns(table)).toEqual(schemas[table])
  await w.noAccess(f,p);checkSentinel();expect(nativeEscoExternal.send).toHaveBeenCalledTimes(smtp)
 }
 expect(segmentComposite(wire.segments.find(s=>s.tag==='BGM'),2,wire.una)[0]).toBe(input.parsed.bgmReference)
}
