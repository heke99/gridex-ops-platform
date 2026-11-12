// local150: real config action with finite SDK observations; no external portal evidence.
// EDIEL01.01–06/U3.1.1 prerequisite component, never whole scenario acceptance.
import {beforeEach,expect,it,vi} from 'vitest'
type Row=Record<string,unknown>
const state=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,writes:[] as Array<{table:string;op:string;payload:Row}>,settings:[] as Row[],deny:false,readinessError:false,settingsError:false,sequence:0,actorReadinessAtWrite:[] as Row[][],identityMode:'normal' as 'normal'|'missing-role'|'ambiguous',mailboxReadError:false}))
const company='15000000-0000-4000-8000-000000000001'
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('next/navigation',()=>({unstable_rethrow:()=>{},redirect:(url:string)=>{throw new Error('REDIRECT:'+url)}}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminActionAccess:async()=>{if(state.deny)throw new Error('admin_denied');return {userId:'15000000-0000-4000-8000-000000000002'}}}))
vi.mock('@/lib/ediel/security/outboundRecipientCertificate',()=>({resolveOutboundRecipientCertificate:()=>{throw new Error('FORBIDDEN_CERTIFICATE_PORT')}}))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory',()=>({fetchReceiverCertificatesFromExpisoft:()=>{throw new Error('FORBIDDEN_DIRECTORY_PORT')}}))
vi.mock('@/lib/errors',()=>({formatErrorMessage:(error:unknown)=>error instanceof Error?error.message:String(error)}))
vi.mock('@/lib/ediel/systemTestSettings',()=>({saveEdielSystemTestSettings:async(input:Row)=>{if(state.settingsError)throw new Error('settings_failed');state.settings.push(structuredClone(input))}}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 rpc:async(name:string,input:{p_command:Row})=>{
  if(name!=='canonical_save_ediel_actor_profile')throw new Error('FORBIDDEN_RPC')
  state.writes.push({table:'rpc',op:name,payload:structuredClone(input.p_command)})
  state.actorReadinessAtWrite.push(structuredClone(state.tables.ediel_agt_readiness??[]))
  const existing=(state.tables.ediel_actor_settings??[]).find(r=>r.company_id===input.p_command.company_id&&r.actor_role===input.p_command.actor_role)
  if(existing)Object.assign(existing,structuredClone(input.p_command))
  else(state.tables.ediel_actor_settings??(state.tables.ediel_actor_settings=[])).push(structuredClone(input.p_command))
  const identities=state.tables.canonical_ediel_profile_identities??(state.tables.canonical_ediel_profile_identities=[])
  const key={company_id:input.p_command.company_id,environment:'test',actor_role:input.p_command.actor_role}
  if(state.identityMode!=='missing-role'){
   const bound=identities.find(r=>Object.entries(key).every(([k,v])=>r[k]===v))
   const profile_id=input.p_command.actor_role==='supplier'?'15000000-0000-4000-8000-000000000005':'15000000-0000-4000-8000-000000000003'
   if(!bound)identities.push({...key,profile_id})
  }
  return {data:null,error:null}
 },
 from:(table:string)=>{
  let op='select',payload:Row={},conflict:string|undefined,one=false,limit=Infinity,columns='*'
  const filters:Array<(row:Row)=>boolean>=[]
  const execute=async()=>{
   const rows=state.tables[table]??(state.tables[table]=[])
   if(table==='ediel_mailboxes'&&op==='select'&&state.mailboxReadError)return {data:null,error:{code:'42703',message:'synthetic mailbox projection unavailable'}}
   if(op!=='select'){
    state.writes.push({table,op,payload:structuredClone(payload)})
    if(table==='ediel_agt_readiness'&&op==='update'&&state.readinessError)return {data:null,error:{code:'42501',message:'readiness_update_denied'}}
   }
   let result:Row[]=[]
   if(op==='insert'||op==='upsert'){
    const keys=conflict?.split(',')
    let row=op==='upsert'&&keys?rows.find(r=>keys.every(k=>r[k]===payload[k])):undefined
    if(row)Object.assign(row,structuredClone(payload))
    else{row={id:'fixture-'+(++state.sequence),...(table==='ediel_route_profiles'?{default_test_flag:1}:{}),...structuredClone(payload)};rows.push(row)}
    result=[row]
   }else{
    result=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit)
    if(op==='update')for(const row of result)Object.assign(row,structuredClone(payload))
   }
   if(table==='canonical_ediel_profile_identities'&&op==='select'&&state.identityMode==='ambiguous'&&result.length)result=[result[0],{...result[0],profile_id:'ambiguous-duplicate'}].slice(0,limit)
   if(one&&result.length>1)return {data:null,error:{code:'PGRST116',message:'multiple_rows'}}
   const projected=result.map(row=>columns==='*'?row:Object.fromEntries(columns.split(',').map(k=>[k.trim(),row[k.trim()]])))
   return {data:one?structuredClone(projected[0]??null):structuredClone(projected),error:null}
  }
  const q={
   select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return q},
   is:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return q},
   ilike:(key:string,value:string)=>{filters.push(r=>String(r[key]??'').toLowerCase()===value.toLowerCase());return q},
   limit:(value:number)=>{limit=value;return q},order:()=>q,
   insert:(value:Row)=>{op='insert';payload=value;return q},
   update:(value:Row)=>{op='update';payload=value;return q},
   upsert:(value:Row,options?:{onConflict?:string})=>{op='upsert';payload=value;conflict=options?.onConflict;return q},
   single:()=>{one=true;return execute()},maybeSingle:()=>{one=true;return execute()},
   then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>execute().then(resolve,reject),
  }
  return q
 },
}}))
import {saveSimpleSystemTestCompanySetupAction,upsertSimpleActorSetting,upsertSystemTestMailbox} from '@/app/admin/ediel/system-tests/actions.part-1'
const confirmationKeys=['test_resource_confirmed','ediel_portal_login_confirmed','application_system_selected','edi_system_selected'] as const
function form(){const f=new FormData();for(const [k,v] of Object.entries({companyId:company,setupPackage:'tgt_dgi_utilts_u3',actorRole:'esco',edielId:'97001',mailbox:'gridex-70007@example.invalid',portalEdielId:'97002',portalEmail:'dso-16700@example.invalid',encryptionMode:'none'}))f.set(k,v);return f}
async function save(f=form()){try{await saveSimpleSystemTestCompanySetupAction(f);throw new Error('missing_redirect')}catch(error){if(error instanceof Error&&error.message.startsWith('REDIRECT:'))return error.message;throw error}}
function configWrites(){return state.writes.filter(w=>['ediel_mailboxes','rpc','communication_routes','ediel_route_profiles'].includes(w.table))}
beforeEach(()=>{state.tables={companies:[{id:company,name:'Synthetic local company'}]};state.writes=[];state.settings=[];state.deny=false;state.readinessError=false;state.settingsError=false;state.sequence=0;state.actorReadinessAtWrite=[];state.identityMode='normal';state.mailboxReadError=false})
it('ordinary TGT config persists test-only canonical settings without inventing portal readiness rows',async()=>{
 const result=await save();expect(result).toContain('setupStatus=success')
 expect(state.tables.ediel_agt_readiness??[]).toEqual([])
 expect(state.writes.filter(w=>w.table==='ediel_agt_readiness'&&w.op==='upsert')).toEqual([])
 expect(state.settings).toHaveLength(1);expect(state.settings[0]).toMatchObject({companyId:company,environmentType:'tgt_test',testSuite:'TGT',messageFamily:'UTILTS'})
 expect(state.writes.find(w=>w.table==='rpc')?.payload).toMatchObject({company_id:company,test_ediel_id:'97001',test_is_active:true,actor_role:'energy_service_company'})
 expect(state.tables.ediel_route_profiles).toHaveLength(1)
 expect(state.tables.ediel_route_profiles[0]).toMatchObject({company_id:company,environment:'test',environment_type:'tgt_test',default_test_flag:1})
})
it('shared actor config holds both family proofs while preserving other company/actor',async()=>{
 const qualified={company_id:company,actor_role:'esco',message_family:'UTILTS',readiness_status:'portal_ready',needs_retest:false,test_resource_confirmed:true,ediel_portal_login_confirmed:true,application_system_selected:true,edi_system_selected:true,readiness_snapshot:{source:'genuine_prior_evidence',witness:'retained'}}
 const foreign={...qualified,company_id:'15000000-0000-4000-8000-000000000004'};const otherActor={...qualified,actor_role:'supplier'};const otherFamily={...qualified,message_family:'PRODAT'}
 state.tables.ediel_agt_readiness=[structuredClone(qualified),structuredClone(foreign),structuredClone(otherActor),structuredClone(otherFamily)]
 await save();const rows=state.tables.ediel_agt_readiness;expect(rows).toHaveLength(4)
 expect(rows[0]).toMatchObject({...qualified,needs_retest:true});for(const key of confirmationKeys)expect(rows[0][key]).toBe(qualified[key])
 expect(rows[1]).toEqual(foreign);expect(rows[2]).toEqual(otherActor);expect(rows[3]).toMatchObject({...otherFamily,needs_retest:true})
})
it('config success text makes no claim that tests are ready to run',async()=>{
 const result=decodeURIComponent(await save());expect(result).not.toContain('Tester är redo att köras')
})
it('returned readiness invalidation error stops config writes and success before partial configuration',async()=>{
 state.readinessError=true;const result=await save();expect(result).toContain('setupStatus=error');expect(configWrites()).toEqual([]);expect(state.settings).toEqual([])
})
it('later configuration failure cannot replace genuine confirmation with fresh fabricated evidence',async()=>{
 state.tables.ediel_agt_readiness=[{company_id:company,actor_role:'esco',message_family:'UTILTS',needs_retest:false,readiness_snapshot:{source:'genuine_prior_evidence'}}]
 state.settingsError=true;expect(await save()).toContain('setupStatus=error');expect(state.tables.ediel_agt_readiness[0]).toMatchObject({needs_retest:true,readiness_snapshot:{source:'genuine_prior_evidence'}})
 expect(state.writes.filter(w=>w.table==='audit_logs'&&w.payload.action==='ediel.system_tests.simple_setup_saved')).toEqual([])
})
it('platform authorization denial has no SDK/config/certificate side effects',async()=>{
 state.deny=true;await expect(save()).rejects.toThrow('admin_denied');expect(state.writes).toEqual([]);expect(state.settings).toEqual([])
})
it('missing company refuses config and readiness mutations',async()=>{
 const f=form();f.delete('companyId');expect(await save(f)).toContain('setupStatus=error');expect(state.writes).toEqual([]);expect(state.settings).toEqual([])
})

it('explicit two-route setup invalidates both configured families before writes without replacing proof',async()=>{
 state.tables.ediel_agt_readiness=['PRODAT','UTILTS'].map(message_family=>({company_id:company,actor_role:'supplier',message_family,needs_retest:false,readiness_snapshot:{source:'genuine_prior_'+message_family}}))
 const f=form();f.set('setupPackage','tgt_ddq_prodat_utilts');f.set('createBothRoutes','true')
 expect(await save(f)).toContain('setupStatus=success')
 for(const row of state.tables.ediel_agt_readiness){expect(row.needs_retest).toBe(true);expect(row.readiness_snapshot).toEqual({source:'genuine_prior_'+row.message_family})}
 const firstConfig=state.writes.findIndex(w=>['ediel_mailboxes','rpc','communication_routes','ediel_route_profiles'].includes(w.table))
 const readinessWrites=state.writes.map((w,index)=>({w,index})).filter(({w})=>w.table==='ediel_agt_readiness')
 expect(readinessWrites).toHaveLength(1);expect(readinessWrites.every(({w,index})=>w.op==='update'&&index<firstConfig)).toBe(true)
})

it('shared test actor 97000 to97001 requires both genuine family proofs held before canonical actor write',async()=>{
 const proofs=['PRODAT','UTILTS'].map(message_family=>({company_id:company,actor_role:'esco',message_family,needs_retest:false,readiness_status:'portal_ready',test_resource_confirmed:true,ediel_portal_login_confirmed:true,application_system_selected:true,edi_system_selected:true,readiness_snapshot:{source:'genuine_'+message_family,actorEdielId:'97000'}}))
 state.tables.ediel_agt_readiness=structuredClone(proofs)
 state.tables.ediel_actor_settings=[{company_id:company,actor_role:'energy_service_company',test_ediel_id:'97000',test_mailbox:'old@example.invalid'}]
 expect(await save()).toContain('setupStatus=success')
 expect(state.tables.ediel_actor_settings[0]).toMatchObject({test_ediel_id:'97001',test_mailbox:'gridex-70007@example.invalid'})
 expect(state.actorReadinessAtWrite).toHaveLength(1)
 for(const row of state.actorReadinessAtWrite[0]){
  expect(row.needs_retest).toBe(true)
  const original=proofs.find(p=>p.message_family===row.message_family)!
  for(const key of confirmationKeys)expect(row[key]).toBe(original[key])
  expect(row.readiness_snapshot).toEqual(original.readiness_snapshot)
 }
 expect(state.actorReadinessAtWrite[0]).toHaveLength(2)
})

// local158/159: exact role-key identity and preservation of qualified transport config.
const supplierProfile='15000000-0000-4000-8000-000000000005'
const escoProfile='15000000-0000-4000-8000-000000000003'
function actorInput(actorRole:'supplier'|'esco'='esco'){return {actorUserId:'15000000-0000-4000-8000-000000000002',companyId:company,actorRole,edielId:'97001',mailbox:'gridex-70007@example.invalid',actorName:'Synthetic local company'}}
function identity(actor_role:string,profile_id:string,company_id=company,environment='test'){return {company_id,environment,actor_role,profile_id}}
it('real setup succeeds when canonical supplier and ESCO identities coexist without replacing another role',async()=>{
 const supplier=identity('supplier',supplierProfile)
 state.tables.canonical_ediel_profile_identities=[structuredClone(supplier)]
 expect(await save()).toContain('setupStatus=success')
 expect(state.tables.canonical_ediel_profile_identities).toHaveLength(2)
 expect(state.tables.canonical_ediel_profile_identities[0]).toEqual(supplier)
 expect(state.tables.canonical_ediel_profile_identities[1]).toEqual(identity('energy_service_company',escoProfile))
})
it.each(['supplier','esco'] as const)('canonical role lookup %s isolates exact company/environment/normalized role',async actorRole=>{
 const foreign=identity('energy_service_company','foreign','15000000-0000-4000-8000-000000000004')
 const production=identity('energy_service_company','production',company,'production')
 const preservedEscoProfile='15000000-0000-4000-8000-000000000013'
 state.tables.canonical_ediel_profile_identities=[identity('supplier',supplierProfile),identity('energy_service_company',preservedEscoProfile),structuredClone(foreign),structuredClone(production)]
 expect(await upsertSimpleActorSetting(actorInput(actorRole))).toBe(actorRole==='esco'?preservedEscoProfile:supplierProfile)
 expect(state.tables.canonical_ediel_profile_identities).toContainEqual(foreign)
 expect(state.tables.canonical_ediel_profile_identities).toContainEqual(production)
 expect(state.tables.canonical_ediel_profile_identities).toHaveLength(4)
})
it('missing requested normalized role never falls back to a different role identity',async()=>{
 state.identityMode='missing-role';state.tables.canonical_ediel_profile_identities=[identity('supplier',supplierProfile)]
 await expect(upsertSimpleActorSetting(actorInput())).rejects.toThrow('Canonical testprofil kunde inte verifieras')
})
it('ambiguous same-key identity returns cardinality error rather than limit1 or fallback',async()=>{
 state.identityMode='ambiguous'
 await expect(upsertSimpleActorSetting(actorInput())).rejects.toMatchObject({code:'PGRST116'})
})
const retainedMailbox='15000000-0000-4000-8000-000000000010'
const qualifiedMetadata={scope:'platform_shared',imap_secure:true,imap_folder:'INBOX',smtp_username:'gridex-70007@example.invalid',smtp_secret_reference:'env:EDIEL_SMTP_PASS',smtp_secure:true,managedFrom:'admin/inbound-mail',retained:{qualification:'synthetic'},source:'prior_configuration',shared_transport_only:false}
function mailboxInput(){return {actorUserId:'15000000-0000-4000-8000-000000000002',email:'gridex-70007@example.invalid',encryptionMode:'none' as const}}
function existingMailbox(metadata:unknown){return {id:retainedMailbox,company_id:null,environment:'test',email_address:'gridex-70007@example.invalid',imap_host:'127.0.0.1',imap_port:55993,smtp_host:'127.0.0.1',smtp_port:55465,username:'gridex-70007@example.invalid',secret_reference:'env:GRIDEX_LOCAL_EDIEL01_IMAP_PASS',metadata}}
it('existing mailbox keeps persisted ID and qualified transport metadata when setup flags merge',async()=>{
 const original=existingMailbox(structuredClone(qualifiedMetadata));state.tables.ediel_mailboxes=[structuredClone(original)]
 expect(await upsertSystemTestMailbox(mailboxInput())).toBe(retainedMailbox)
 expect(state.tables.ediel_mailboxes).toHaveLength(1)
 const row=state.tables.ediel_mailboxes[0];expect(row).toMatchObject({id:retainedMailbox,imap_host:original.imap_host,imap_port:55993,smtp_host:original.smtp_host,smtp_port:55465,username:original.username,secret_reference:original.secret_reference})
 expect(row.metadata).toEqual({...qualifiedMetadata,source:'admin_ediel_system_tests_simple_setup',shared_transport_only:true,gridex_is_ediel_agent:false,receiver_certificate_must_live_on_route:true})
})
it.each([{metadata:[]},{metadata:['invalid']},{metadata:'invalid'}] as Array<{metadata:unknown}>)('unsupported existing metadata JSON shape $metadata refuses before update',async ({metadata})=>{
 const original=existingMailbox(metadata);state.tables.ediel_mailboxes=[structuredClone(original)]
 await expect(upsertSystemTestMailbox(mailboxInput())).rejects.toThrow('metadata')
 expect(state.tables.ediel_mailboxes).toEqual([original]);expect(state.writes).toEqual([])
})
it('unavailable mailbox projection cannot create a replacement or discard existing metadata',async()=>{
 state.tables.ediel_mailboxes=[existingMailbox(structuredClone(qualifiedMetadata))];state.mailboxReadError=true
 await expect(upsertSystemTestMailbox(mailboxInput())).rejects.toMatchObject({code:'42703'})
 expect(state.tables.ediel_mailboxes).toHaveLength(1);expect(state.writes).toEqual([])
})
