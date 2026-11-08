// local190: real delivery/accept/password actions with isolated SDK/Auth ports.
// No live credentials, users, memberships or session injection; native RLS proof is separate.
import {createHash,randomUUID} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({users:[] as Record<string,unknown>[],invites:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],
 commands:[] as Record<string,unknown>[],current:null as Record<string,unknown>|null,canonical:vi.fn(),updatePassword:vi.fn(),clearFlags:vi.fn(),
 invite:vi.fn(),otp:vi.fn(),adminUpdate:vi.fn(),eventReadError:false,eventWriteError:null as string|null,clientWrites:0,sequence:0,
}))
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw Error('REDIRECT:'+path)}}))
vi.mock('@/lib/tenant/passwordResetEmail',()=>({sendTenantBrandedPasswordResetEmail:vi.fn(()=>{throw Error('unexpected_reset_email')})}))
vi.mock('@/lib/auth/companyUserAccess',()=>({acceptCompanyInvitationAccess:io.canonical}))
vi.mock('@/lib/auth/directAccountProvisioning',()=>({clearTemporaryPasswordFlags:io.clearFlags}))
function scalar(row:Record<string,unknown>,key:string):unknown{const [field,nested]=key.split('->>');if(!nested)return row[field];const v=(row[field] as Record<string,unknown>|null)?.[nested];return v==null?v:String(v)}
function sdk(table:string,authenticated=false){
 const filters:((row:Record<string,unknown>)=>boolean)[]=[];let op='read',values:Record<string,unknown>={},one=false,descending=false,orderKey='',limit=Infinity
 const run=()=>{
  if(authenticated&&table==='auth_email_events'){if(op!=='read')io.clientWrites++;return {data:null,error:{code:'42501',message:'RLS permission denied'}}}
  if(table==='auth_email_events'&&(op==='read'?io.eventReadError:io.eventWriteError===String(values.status)))return {data:null,error:new Error('event_'+op+'_denied')}
  const source=table==='company_invitations'?io.invites:table==='auth_email_events'?io.events:table==='canonical_command_results'?io.commands:table==='companies'?[{id:A,name:'Synthetic A'}]:table==='user_profiles'?[]:null
  if(!source)throw Error('unexpected_table:'+table)
  if(op==='insert'){const row={id:randomUUID(),created_at:new Date(Date.now()+io.sequence++).toISOString(),...values};source.push(row);return {data:one?row:[row],error:null}}
  let rows=source.filter(row=>filters.every(f=>f(row)))
  if(op==='update')for(const row of rows)Object.assign(row,values)
  if(op==='upsert')return {data:null,error:null}
  if(orderKey)rows.sort((a,b)=>String(scalar(a,orderKey)).localeCompare(String(scalar(b,orderKey)))*(descending?-1:1))
  rows=rows.slice(0,limit)
  if(one&&rows.length>1)return {data:null,error:new Error('multiple_rows')}
  return {data:one?(rows[0]??null):rows,error:null}
 }
 const q={select:()=>q,eq:(key:string,v:unknown)=>{filters.push(row=>scalar(row,key)===v);return q},in:(key:string,vs:unknown[])=>{filters.push(row=>vs.includes(scalar(row,key)));return q},
  contains:(key:string,v:Record<string,unknown>)=>{filters.push(row=>Object.entries(v).every(([k,x])=>(row[key] as Record<string,unknown>)?.[k]===x));return q},
  order:(key:string,opts?:{ascending?:boolean})=>{orderKey=key;descending=opts?.ascending===false;return q},limit:(n:number)=>{limit=n;return q},
  insert:(v:Record<string,unknown>)=>{op='insert';values=v;return q},update:(v:Record<string,unknown>)=>{op='update';values=v;return q},delete:()=>{op='delete';return q},upsert:(v:Record<string,unknown>)=>{op='upsert';values=v;return q},
  maybeSingle:async()=>{one=true;return run()},single:async()=>{one=true;return run()},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(run()).then(resolve)};return q
}
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>sdk(table),auth:{admin:{listUsers:async()=>({data:{users:io.users},error:null}),inviteUserByEmail:io.invite,updateUserById:io.adminUpdate},signInWithOtp:io.otp}}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:io.current},error:null}),updateUser:io.updatePassword},from:(table:string)=>sdk(table,true)})}))
import {deliverCompanyInvitationIntent} from '@/lib/auth/companyInvitationFlow'
import {acceptCompanyInvitationAction} from '@/app/auth/company-invite/actions'
import {updatePasswordAction} from '@/app/login/update-password/actions'
import {createSupabaseServerClient} from '@/lib/supabase/server'
const A='00000000-0000-4000-8000-000000000190',B='00000000-0000-4000-8000-000000000191',U='00000000-0000-4000-8000-000000000192',I='00000000-0000-4000-8000-000000000193',token='synthetic-invitation-token-190'
const user=()=>({id:U,email:'synthetic-invite@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{}})
const input={invitationId:I,companyId:A,email:'synthetic-invite@example.invalid',fullName:'Synthetic local',token,actorUserId:B,source:'company_users',membershipRole:'viewer',roleKey:'finance_readonly'}
function acceptForm(){const f=new FormData();f.set('token',token);return f}
function passwordForm(next='/auth/company-invite?token='+encodeURIComponent(token)){const f=new FormData();f.set('password','fixture-password-190');f.set('confirmPassword','fixture-password-190');f.set('next',next);return f}
async function location(f:()=>Promise<unknown>){try{await f();return 'NO_REDIRECT'}catch(e){const text=(e as Error).message;if(text.startsWith('REDIRECT:'))return text.slice(9);throw e}}
async function deliver(existing=false){if(existing)io.users=[user()];await deliverCompanyInvitationIntent(input)}
async function acceptedNew(){await deliver();await location(()=>acceptCompanyInvitationAction(acceptForm()))}
const setupEvents=()=>io.events.filter(row=>row.event_type==='password_updated'&&row.source==='company_invitation_password_setup_v1')
beforeEach(()=>{
 vi.clearAllMocks();io.users=[];io.events=[];io.current=user();io.eventReadError=false;io.eventWriteError=null;io.clientWrites=0;io.sequence=0
 io.invites=[{id:I,company_id:A,email:input.email,membership_role:'viewer',role_key:'finance_readonly',status:'pending',invited_user_id:U,expires_at:'2099-01-01T00:00:00Z',accept_token_hash:createHash('sha256').update(token).digest('hex')}]
 io.commands=[{company_id:A,command_type:'tenant.invitation.create',request_payload:{company_id:A,channel:'ops'},result_payload:{invitation_id:I}}]
 io.invite.mockImplementation(async()=>{const u=user();io.users.push(u);return {data:{user:u},error:null}});io.adminUpdate.mockImplementation(async(id:string)=>({data:{user:io.users.find(row=>row.id===id)??user()},error:null}));io.otp.mockResolvedValue({data:{},error:null});io.clearFlags.mockResolvedValue(undefined)
 io.updatePassword.mockResolvedValue({data:{user:user()},error:null});io.canonical.mockImplementation(async()=>{io.invites[0].status='accepted'})
 process.env.NEXT_PUBLIC_APP_URL='http://127.0.0.1:3301'
})
it('genuinely new delivery followed by canonical accept continues to the existing password form without changing a password',async()=>{
 await deliver();const path=await location(()=>acceptCompanyInvitationAction(acceptForm()));expect(path).toMatch(/^\/login\/update-password\?/);expect(new URL(path,'http://local').searchParams.get('next')).toBe('/auth/company-invite?token='+token);expect(io.canonical).toHaveBeenCalledOnce();expect(io.canonical).toHaveBeenCalledWith(expect.objectContaining({companyId:A,userId:U,invitationId:I}));expect(io.updatePassword).not.toHaveBeenCalled()
})
it('existing-user OTP cross-company enrollment never forces a password form or reset',async()=>{
 await deliver(true);expect(io.otp).toHaveBeenCalledWith(expect.objectContaining({options:expect.objectContaining({shouldCreateUser:false})}));expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/login\?message=/);expect(io.invite).not.toHaveBeenCalled();expect(io.updatePassword).not.toHaveBeenCalled()
})
it('never trusts posted type/new-user/completed flags or user metadata instead of trusted original delivery',async()=>{
 await deliver();io.current!.user_metadata={password_changed_at:'2099-01-01',setup_complete:true,existingUser:true};const f=acceptForm();f.set('type','magiclink');f.set('existingUser','true');f.set('setup_complete','true');expect(await location(()=>acceptCompanyInvitationAction(f))).toMatch(/^\/login\/update-password/)
})
it('does not turn an existing-user invite into new setup using hostile posted flags',async()=>{
 await deliver(true);const f=acceptForm();f.set('type','invite');f.set('existingUser','false');expect(await location(()=>acceptCompanyInvitationAction(f))).toMatch(/^\/login\?message=/)
})
it.each(['user_id','company_id','metadata.invitationId','email'] as const)('does not borrow delivery provenance with mismatched %s',async(field)=>{
 await deliver();for(const row of io.events)if(row.event_type==='invite_sent'){
  if(field==='metadata.invitationId')(row.metadata as Record<string,unknown>).invitationId=B
  else row[field]=field==='email'?'another-identity@example.invalid':B
 }
 expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/login\?message=/)
 expect(io.updatePassword).not.toHaveBeenCalled();expect(setupEvents()).toEqual([])
 expect(io.canonical).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({companyId:A,userId:U,invitationId:I,email:input.email}))
})
it('refuses an authenticated identity different from the invitation before canonical effects',async()=>{
 await deliver();io.current={...user(),id:B};expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/auth\/company-invite\?error=/);expect(io.canonical).not.toHaveBeenCalled();expect(io.updatePassword).not.toHaveBeenCalled()
})
it('retains expired invitation denial before any acceptance/setup effects',async()=>{
 await deliver();io.invites[0].expires_at='2000-01-01T00:00:00Z';expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/auth\/company-invite\?error=/);expect(io.canonical).not.toHaveBeenCalled()
})
it('retains independent portal denial and canonical failure with no setup redirect',async()=>{
 await deliver();io.commands[0].request_payload={company_id:A,channel:'staff_api',staff_operation:'invite',api_client_id:B};expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/auth\/company-invite\?error=/);expect(io.canonical).not.toHaveBeenCalled()
})
it('propagates canonical refusal without a password change or setup success',async()=>{
 await deliver();io.canonical.mockRejectedValue(new Error('canonical_denied'));expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/auth\/company-invite\?error=/);expect(io.updatePassword).not.toHaveBeenCalled()
})
it('uses the original explicit password form and existing invitation continuation without a new ledger',async()=>{
 await acceptedNew();const path=await location(()=>updatePasswordAction(passwordForm()));const url=new URL(path,'http://local');expect(url.pathname).toBe('/auth/company-invite');expect(url.searchParams.get('token')).toBe(token);expect(url.searchParams.has('message')).toBe(true);expect(io.updatePassword).toHaveBeenCalledOnce();expect(setupEvents()).toEqual([]);expect(io.canonical).toHaveBeenCalledOnce()
})
it('accepted/completed setup replay never forces another password selection or duplicates canonical effects',async()=>{
 await acceptedNew();await location(()=>updatePasswordAction(passwordForm()));expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/login\?message=/);expect(io.canonical).toHaveBeenCalledOnce();expect(io.updatePassword).toHaveBeenCalledOnce()
})
it('preserves pre-fix already-accepted setup replay without trusting mutable password metadata',async()=>{
 await deliver();io.invites[0].status='accepted';expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/login\?message=/);expect(io.canonical).not.toHaveBeenCalled();expect(io.updatePassword).not.toHaveBeenCalled()
})
it('does not add a new receipt dependency to the existing password action',async()=>{
 await acceptedNew();io.eventReadError=true;io.eventWriteError='created';const before=JSON.stringify(io.events);expect(new URL(await location(()=>updatePasswordAction(passwordForm())),'http://local').pathname).toBe('/auth/company-invite');expect(io.updatePassword).toHaveBeenCalledOnce();expect(JSON.stringify(io.events)).toBe(before);expect(setupEvents()).toEqual([])
})
it('preserves normal Auth failure flash and a later explicit password retry without automatic retries',async()=>{
 await acceptedNew();io.updatePassword.mockResolvedValueOnce({data:null,error:new Error('auth_update_failed')});const first=await location(()=>updatePasswordAction(passwordForm()));const url=new URL(first,'http://local');expect(url.pathname).toBe('/login/update-password');expect(url.searchParams.has('error')).toBe(true);expect(url.searchParams.get('next')).toBe('/auth/company-invite?token='+token);expect(io.updatePassword).toHaveBeenCalledOnce();expect(io.clearFlags).not.toHaveBeenCalled();expect(io.invites[0].status).toBe('accepted');expect(setupEvents()).toEqual([])
 const second=await location(()=>updatePasswordAction(passwordForm()));expect(new URL(second,'http://local').pathname).toBe('/auth/company-invite');expect(io.updatePassword).toHaveBeenCalledTimes(2);expect(io.canonical).toHaveBeenCalledOnce()
})
it('preserves existing optional profile-sync failure handling after actual Auth success',async()=>{
 await acceptedNew();io.clearFlags.mockRejectedValue(new Error('optional_profile_sync_failed'));const path=await location(()=>updatePasswordAction(passwordForm()));expect(new URL(path,'http://local').pathname).toBe('/auth/company-invite');expect(io.updatePassword).toHaveBeenCalledOnce();expect(setupEvents()).toEqual([]);expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/login\?message=/);expect(io.canonical).toHaveBeenCalledOnce()
})
it('does not weaken ordinary password recovery or require invitation markers for its explicit form',async()=>{
 expect(await location(()=>updatePasswordAction(passwordForm('/dashboard')))).toMatch(/^\/dashboard\?message=/);expect(io.updatePassword).toHaveBeenCalledOnce();expect(setupEvents()).toEqual([]);expect(io.canonical).not.toHaveBeenCalled()
})
it('keeps password mutation bound to the authenticated session rather than posted invitation or completion flags',async()=>{
 await acceptedNew();const before=JSON.stringify(io.events);io.invites[0].invited_user_id=B;const f=passwordForm();f.set('setup_complete','true');f.set('user_id',B);await location(()=>updatePasswordAction(f));expect(io.updatePassword).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({password:'fixture-password-190'}));expect(io.updatePassword.mock.calls[0][0]).not.toHaveProperty('user_id');expect(JSON.stringify(io.events)).toBe(before);expect(setupEvents()).toEqual([]);expect(io.canonical).toHaveBeenCalledOnce()
})
it('models client receipt insert/update/delete denial; native RLS qualification is separately required',async()=>{
 const c=await createSupabaseServerClient();for(const q of [c.from('auth_email_events').insert({event_type:'password_updated',status:'verified'}),c.from('auth_email_events').update({metadata:{existingUser:false}}),c.from('auth_email_events').delete()])expect((await q).error?.code).toBe('42501');expect(io.events).toEqual([])
})

it('refuses ambiguous new-account delivery evidence instead of selecting a convenient receipt',async()=>{
 await deliver();const original=io.events.find(row=>row.event_type==='invite_sent')!;io.events.push({...original,id:randomUUID()});expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/auth\/company-invite\?error=/);expect(io.canonical).not.toHaveBeenCalled();expect(io.updatePassword).not.toHaveBeenCalled()
})

it('handles a protected delivery lookup error inside the acceptance error path before canonical effects',async()=>{
 await deliver();io.eventReadError=true;expect(await location(()=>acceptCompanyInvitationAction(acceptForm()))).toMatch(/^\/auth\/company-invite\?error=/);expect(io.canonical).not.toHaveBeenCalled();expect(io.updatePassword).not.toHaveBeenCalled()
})
