'use strict';
// Declared owned TEST fixture, not a claim that a Next UI action ran.
// Communication route and readiness invalidation use unchanged normal exports.
// New profile INSERT uses the actual authenticated user client/native RLS.
const COMPANY='b36f6a30-18cd-4a70-8652-5b2da9b4eb64',ACTOR='ee029de5-22a8-4916-9c36-388d13f19cb1';
const CASES=['SMTP_451','SMTP_550','SMTP_DROP_DATA'];
const need=(v,m)=>{if(!v)throw Error(m)},uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function config(c){
 need(c?.state==='BOUND_NORMAL_ACK_ROUTE_FIXTURES'&&c.companyId===COMPANY&&c.receiverEdielId==='99003'&&uuid(c.cohortId)&&typeof c.smtpFrom==='string'&&/^[a-z0-9.-]+@fixture\.invalid$/.test(c.smtpFrom),'CLOSED_ACK_ROUTE_CONFIG');
 need(Array.isArray(c.cases)&&c.cases.length===3&&c.cases.every((x,i)=>x.caseName===CASES[i]&&/^\d{5}$/.test(x.senderEdielId)&&x.senderEdielId!==c.receiverEdielId&&/^[a-z0-9.-]+@fixture\.invalid$/.test(x.recipientEmail)&&x.smtpHost==='127.0.0.1'&&Number.isInteger(x.smtpPort)&&x.smtpPort>=1024&&x.smtpPort<=65535),'THREE_FIXED_OWN_ACK_ENDPOINTS');
 need(new Set(c.cases.map(x=>x.senderEdielId)).size===3&&new Set(c.cases.map(x=>x.smtpPort)).size===3,'NO_AMBIGUOUS_REVERSE_IDENTITY_OR_ENDPOINT');return c;
}
async function principal(client){
 const u=await client.auth.getUser();need(!u.error&&u.data.user?.id===ACTOR,'GENUINE_MAIN_GETUSER_FOR_ROUTE_FIXTURE');
 const p=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:COMPANY});need(!p.error&&p.data?.user_id===ACTOR&&p.data?.selected_company_id===COMPANY&&p.data?.is_platform_admin===true&&p.data?.authorized===true&&p.data?.access_invariant_ok===true,'GENUINE_CANONICAL_ROUTE_FIXTURE_ADMIN');return u.data.user;
}
function profilePayload(c,x,routeId){
 config(c);need(uuid(routeId)&&c.cases.includes(x),'ACTUAL_RETURNED_ROUTE_ID');
 // Exact normal profile-form field meanings for a fresh generic ACK profile.
 // Blank family/code legitimately supports CONTRL and collateral APERAK. TLS
 // remains strict; "unencrypted" is EDIFACT payload encryption, not TLS bypass.
 return{company_id:COMPANY,communication_route_id:routeId,is_enabled:true,is_active:true,message_family:null,business_code:null,
  sender_ediel_id:c.receiverEdielId,sender_name:'Owned TEST receiver',sender_sub_address:null,
  receiver_ediel_id:x.senderEdielId,receiver_name:'Owned synthetic SMTP sender',receiver_sub_address:null,
  receiver_subaddress:null,receiver_message_subaddress:null,subaddress_required:false,
  application_reference:'23-DDQ-PRODAT',default_message_version:null,default_test_flag:1,default_timezone:1,
  environment:'test',environment_type:'tgt_test',message_standard:'edifact',ack_mode:'default',
  smtp_host:x.smtpHost,smtp_port:x.smtpPort,imap_host:null,imap_port:null,mailbox:c.smtpFrom,
  encryption_mode:'none',transport_security_mode:'unencrypted',signing_mode:'none',certificate_id:null,
  receiver_certificate_id:null,certificate_required:false,allow_unencrypted_production:false,
  allow_unencrypted_production_expires_at:null,allow_unencrypted_production_reason:null,
  allow_unencrypted_production_granted_by:null,security_policy_status:'test_unencrypted_allowed',
  payload_format:'edifact',notes:'Isolated original four-case ACK route '+x.caseName,
  updated_by:ACTOR,updated_at:new Date().toISOString(),created_by:ACTOR};
}
async function create(modules,client,c){
 config(c);await principal(client);await modules.authorization.assertEdielTenantActor({companyId:COMPANY,actorUserId:ACTOR,permission:'communication.write'});
 await modules.governance.requireCompanyOperationalForWrites(COMPANY);
 const result=[];
 for(const x of c.cases){
  await principal(client);
  const routeName='Owned original four-case '+c.cohortId+' '+x.caseName;
  // Preflight requires this name and reverse identity absent in the own clone.
  const route=await modules.routes.saveCommunicationRoute({actorUserId:ACTOR,companyId:COMPANY,routeName,isActive:true,
   routeScope:'ediel_ack',routeType:'ediel_partner',gridOwnerId:null,targetSystem:'owned_local_test_smtp',
   endpoint:x.recipientEmail,targetEmail:x.recipientEmail,supportedPayloadVersion:'edifact',
   notes:'Declared isolated original SMTP case '+x.caseName});
  need(uuid(route?.id)&&route.company_id===COMPANY&&route.route_scope==='ediel_ack'&&route.is_active===true&&route.target_email===x.recipientEmail,'NORMAL_ACTUAL_EDIEL_ACK_ROUTE');
  // The ordinary bootstrap/setup exposes this existing TEST environment field;
  // saveCommunicationRoute's narrower shared DTO omits it. Keep this new route
  // in TEST via the actual authenticated native-RLS fixture client, before any
  // source/ACK or attempt can bind it.
  const scoped=await client.from('communication_routes').update({environment_type:'tgt_test'}).eq('id',route.id).eq('company_id',COMPANY).select('*').single();if(scoped.error)throw scoped.error;
  need(scoped.data?.id===route.id&&scoped.data.company_id===COMPANY&&scoped.data.environment_type==='tgt_test','ACTUAL_AUTHENTICATED_TEST_ROUTE_ENVIRONMENT');
  Object.assign(route,scoped.data);
  const payload=profilePayload(c,x,route.id);
  // Actual user JWT/native RLS INSERT; no service-role substitute or private
  // action helper extraction. Real request routing is fixed by the worker.
  const r=await client.from('ediel_route_profiles').insert(payload).select('*').single();if(r.error)throw r.error;
  need(uuid(r.data?.id)&&r.data.company_id===COMPANY&&r.data.communication_route_id===route.id&&r.data.mailbox===c.smtpFrom&&r.data.environment==='test'&&r.data.is_enabled===true,'ACTUAL_AUTHENTICATED_ROUTE_PROFILE_RETURN');
  await modules.invalidation.invalidateEdielAgtReadiness({companyId:COMPANY,sourceType:'route_change',sourceId:route.id,
   reason:'Declared isolated TEST ACK route/profile changed; normal AGT retest required.',actorUserId:ACTOR});
  result.push({caseName:x.caseName,route,profile:r.data,uiActionInvoked:false,profileTransportRole:'authenticated'});
 }
 return result;
}
module.exports={COMPANY,ACTOR,CASES,config,profilePayload,create};
