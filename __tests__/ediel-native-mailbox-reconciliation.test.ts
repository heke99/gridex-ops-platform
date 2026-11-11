import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const ports=vi.hoisted(()=>({parse:vi.fn(),create:vi.fn(),reception:vi.fn()}))
vi.mock('@/lib/inbound-mail/edielEmailParser',()=>({parseEdifactPayload:ports.parse}))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater',()=>({createParseResult:ports.create}))
vi.mock('@/lib/ediel/inbound/receptions',()=>({recordInboundReception:ports.reception}))
import {seedOriginalMailboxNative} from '../scripts/helpers/originalMailboxNative'
const company='11111111-1111-4111-8111-111111111111',mailbox='22222222-2222-4222-8222-222222222222'
const input={companyId:company,environment:'test' as const,raw:"UNB+SYNTHETIC?'raw\r\n",smtpFrom:'synthetic@example.invalid',receivedAt:'2026-11-11T12:00:00Z'}
const literal=(x:unknown)=>"'"+String(x).replaceAll("'","''")+"'"
type Candidate={id:string;company:string;environment:string;email:string;active:boolean;shared:boolean;purpose:string}
const own=():Candidate=>({id:mailbox,company,environment:'test',email:input.smtpFrom,active:true,shared:false,purpose:'prospective_original_ingress_v1'})
function port(rows:Candidate[]){
 const state={allowed:true,queries:[] as string[],mailBirths:0,mailboxBirths:0}
 const sql=<T>(query:string):T=>{
  state.queries.push(query)
  if(query.trimStart().startsWith('SELECT')){
   // Declared finite SQL port: preserve the actual tenant/environment/address/purpose selector.
   for(const clause of [`company_id=${literal(company)}`,"environment='test'",`email_address=${literal(input.smtpFrom)}`,"metadata->>'native_fixture_purpose'='prospective_original_ingress_v1'",'is_active'])expect(query).toContain(clause)
   const nonsharedOnly=/\bis_shared_platform_mailbox\s+IS\s+FALSE\b/i.test(query)
   return rows.filter(r=>(!nonsharedOnly||r.shared===false)&&r.company===company&&r.environment==='test'&&r.email===input.smtpFrom&&r.active&&r.purpose==='prospective_original_ingress_v1').map(r=>({id:r.id})) as T
  }
  if(query.includes('INSERT INTO public.ediel_mailboxes')){state.mailboxBirths++;state.allowed=false}
  if(query.includes('INSERT INTO public.inbound_email_messages'))state.mailBirths++
  return undefined as T
 }
 return {state,sql}
}
beforeEach(()=>{ports.parse.mockReset();ports.parse.mockImplementation((raw:string)=>({rawPayload:raw}));ports.create.mockReset();ports.create.mockResolvedValue('parse-id');ports.reception.mockReset()})
it('preserves existing ALLOW by reusing exact prospective own mailbox, with fresh mail/source bytes',async()=>{
 const {state,sql}=port([own()]);const result=await seedOriginalMailboxNative(sql,literal,input)
 expect(result.mailboxId).toBe(mailbox);expect(state.allowed).toBe(true);expect(state.mailboxBirths).toBe(0);expect(state.mailBirths).toBe(1)
 expect(result.sourcePayloadHash).toBe(createHash('sha256').update(input.raw).digest('hex'))
 expect(state.queries.find(q=>q.includes('inbound_email_messages'))).toContain(literal(input.raw));expect(ports.create).toHaveBeenCalledWith({inboundEmailMessageId:result.inboundEmailMessageId,companyId:company,parsed:{rawPayload:input.raw}})
 expect(ports.reception).not.toHaveBeenCalled()
})
it.each(['company','environment','email','active','purpose'] as const)('does not reuse a wrong %s candidate and retains new-mailbox invalidation',async field=>{
 const row=own();if(field==='active')row.active=false;else row[field]='other'
 const {state,sql}=port([row]);const result=await seedOriginalMailboxNative(sql,literal,input)
 expect(result.mailboxId).not.toBe(mailbox);expect(state.allowed).toBe(false);expect(state.mailboxBirths).toBe(1);expect(state.mailBirths).toBe(1)
})
it('refuses ambiguous prospective mailboxes before new mailbox/mail/parse effects',async()=>{
 const {state,sql}=port([own(),{...own(),id:'33333333-3333-4333-8333-333333333333'}])
 await expect(seedOriginalMailboxNative(sql,literal,input)).rejects.toThrow('native_original_prospective_mailbox_ambiguous')
 expect(state.mailboxBirths).toBe(0);expect(state.mailBirths).toBe(0);expect(ports.create).not.toHaveBeenCalled()
})
it('does not extend prospective TEST selection to production',async()=>{
 const {state,sql}=port([own()]);await seedOriginalMailboxNative(sql,literal,{...input,environment:'production'})
 expect(state.queries.some(q=>q.trimStart().startsWith('SELECT'))).toBe(false);expect(state.mailboxBirths).toBe(1)
})

it('does not reuse an own marked shared=true mailbox; new custody still invalidates',async()=>{
 const {state,sql}=port([{...own(),shared:true}]);const result=await seedOriginalMailboxNative(sql,literal,input)
 expect(result.mailboxId).not.toBe(mailbox);expect(state.mailboxBirths).toBe(1);expect(state.mailBirths).toBe(1);expect(state.allowed).toBe(false)
})
