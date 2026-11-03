// Pure setup/restore regression with declared synthetic catalog/SQL ports.
// No PostgreSQL, native service, hosted project or permission change executes.
import {beforeEach, afterEach, expect, it, vi} from 'vitest'
import {readFileSync} from 'node:fs'
const h=vi.hoisted(()=>({sql:vi.fn(),installed:false,failReadback:false,baseline:{} as unknown,statements:[] as string[]}))
vi.mock('@/scripts/helpers/ediel-normal-switch-native-fixture',()=>({nativeSql:h.sql,literal:(v:unknown)=>v==null?'NULL':`'${String(v).replaceAll("'","''")}'`}))
import * as helper from '@/scripts/helpers/ediel-poa-contract-trigger-profile.native'
const actual=JSON.parse(readFileSync('scripts/helpers/ediel-poa-contract-trigger-profile.native.json','utf8')) as {
 functions:{identity:string;ddl:string;owner:string;acl:string|null;bodyMD5:string}[];
 triggers:{name:string;ddl:string;enabled:'O'|'A';function:string;bodyMD5:string}[];
 candidateGuardBodyMD5:string;candidateSQLSHA256:string;
}
type Baseline={functions:{identity:string;ddl:string;owner:string;acl:string|null}[];triggers:{name:string;ddl:string;enabled:'O'|'A';function:string}[]}
type Delta={functions:typeof actual.functions;triggers:typeof actual.triggers}
const missing=new Set(['customer_contracts_tenant_operational_guard_trg','gridex_audit_customer_contracts','gridex_customer_contracts_company_guard_tg','trg_customer_contracts_updated_at','trg_gridex_customer_contracts_auto_renew_guard'])
const baseline=():Baseline=>({functions:structuredClone(actual.functions),triggers:actual.triggers.filter(t=>!missing.has(t.name)).map(({name,ddl,enabled,function:binding})=>({name,ddl,enabled,function:binding}))})
const plan=(b:Baseline)=>{
 const fn=Reflect.get(helper,'planPoaProfileDelta') as ((b:Baseline)=>Delta)|undefined
 expect(fn,'The public-only planner must protect existing restricted objects before any SQL').toBeTypeOf('function')
 return fn!(b)
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:54321')
 h.installed=false;h.failReadback=false;h.baseline=baseline();h.statements=[]
 h.sql.mockImplementation((query:string)=>{
  if(query.startsWith("SELECT jsonb_build_object('functions'"))return structuredClone(h.installed?{functions:actual.functions,triggers:actual.triggers.map(({name,ddl,enabled,function:binding})=>({name,ddl,enabled,function:binding}))}:h.baseline)
  if(query.startsWith('SELECT to_jsonb(md5(prosrc))'))return actual.candidateGuardBodyMD5
  if(query.startsWith('SELECT to_jsonb(count(*)=')&&query.includes('bool_and'))return !h.failReadback
  if(query.startsWith('SELECT jsonb_agg(jsonb_build_object(\'name\''))return actual.triggers.map(t=>({name:t.name,enabled:t.enabled,bodyMD5:t.function==='public.gridex_customer_contracts_auto_renew_guard()'?actual.candidateGuardBodyMD5:t.bodyMD5})).sort((a,b)=>a.name.localeCompare(b.name))
  if(query.startsWith('SELECT coalesce(jsonb_agg(jsonb_build_object(\'grantee\''))return [{grantee:'postgres',grantable:false}]
  if(query.startsWith('SELECT coalesce(jsonb_agg(DISTINCT'))return ['PUBLIC','postgres']
  if(query.startsWith('SELECT to_jsonb(count(*))'))return 26
  if(query.startsWith('BEGIN;')){
   h.statements.push(query)
   if(/(?:CREATE(?: OR REPLACE)?|ALTER|DROP) FUNCTION (?:gridex_ediel_retention|gridex_correction_process)\./i.test(query)
    || /DROP TRIGGER "(?:customer_contracts_lock_signed|zz_record_retention_target|e035_process_after_write|e035_process_before_delete|e035_process_no_truncate)"/.test(query))throw Error('synthetic_protected_object_mutation')
   h.installed=query.includes('CREATE TRIGGER');return null
  }
  throw Error('unexpected_synthetic_catalog_port')
 })
})
afterEach(()=>{vi.unstubAllEnvs()})
it('installs all five missing public triggers and restores the original catalog without touching protected objects',()=>{
 const overlay=helper.installPoaContractTriggerProfile();expect(h.installed).toBe(true)
 overlay.assertInstalled();overlay.restore();expect(h.installed).toBe(false)
 const count=h.statements.length;overlay.restore();expect(h.statements).toHaveLength(count)
 expect(h.statements).toHaveLength(2)
 expect(h.statements[0].match(/CREATE TRIGGER /g)).toHaveLength(5)
 expect(h.statements[1].match(/DROP TRIGGER /g)).toHaveLength(5)
})
it('plans only the actual five public additions and preserves all 21 existing triggers',()=>{
 const d=plan(baseline());expect(d.functions).toEqual([]);expect(d.triggers.map(t=>t.name).sort()).toEqual([...missing].sort())
 expect(h.sql).not.toHaveBeenCalled()
})
it('restores its public delta after a failed full-profile readback without touching protected objects',()=>{
 h.failReadback=true
 expect(()=>helper.installPoaContractTriggerProfile()).toThrow('actual_profile_function_owner_acl_body_mismatch')
 expect(h.installed).toBe(false);expect(h.statements).toHaveLength(2)
})
it.each(['ddl','owner','acl'] as const)('refuses protected function %s drift before a write',field=>{
 const b=baseline(),f=b.functions.find(f=>f.identity.startsWith('gridex_ediel_retention.'))!
 f[field]=`${f[field]} changed`;expect(()=>plan(b)).toThrow('poa_profile_protected_function_changed');expect(h.statements).toEqual([])
})
it('also preserves non-public correction functions even though their owner is postgres',()=>{
 const b=baseline();b.functions.find(f=>f.identity.startsWith('gridex_correction_process.'))!.ddl+=' changed'
 expect(()=>plan(b)).toThrow('poa_profile_protected_function_changed')
})
it.each(['ddl','enabled','missing'] as const)('refuses protected trigger %s drift before a write',field=>{
 const b=baseline(),t=b.triggers.find(t=>t.name==='customer_contracts_lock_signed')!
 if(field==='missing')b.triggers=b.triggers.filter(row=>row!==t)
 else if(field==='enabled')t.enabled='A'
 else t.ddl+=' changed'
 expect(()=>plan(b)).toThrow('poa_profile_protected_trigger_changed');expect(h.statements).toEqual([])
})
it('refuses an unexpected baseline trigger instead of deleting an unqualified guard',()=>{
 const b=baseline();b.triggers.push({name:'unexpected_guard',ddl:'synthetic guard',enabled:'A',function:'public.unexpected_guard()'})
 expect(()=>plan(b)).toThrow('poa_profile_unrecognized_baseline_trigger')
})
it.each(['D','R'])('refuses unsupported baseline trigger mode %s before any mutation',mode=>{
 const b=baseline();b.triggers[0].enabled=mode as 'O'
 expect(()=>plan(b)).toThrow('poa_profile_unsupported_baseline_trigger_mode');expect(h.statements).toEqual([])
})
it('refuses a known public-target trigger rebound to a protected function',()=>{
 const b=baseline();b.triggers[0].function='gridex_ediel_retention.record_target_guard_v1()'
 expect(()=>plan(b)).toThrow('poa_profile_trigger_binding_changed');expect(h.statements).toEqual([])
})
it('never changes a public function with a protected baseline owner',()=>{
 const b=baseline();b.functions.find(f=>f.identity.startsWith('public.'))!.owner='protected_owner'
 expect(()=>plan(b)).toThrow('poa_profile_protected_function_changed')
})
it('restores only a changed public function and applies its final ACL within each atomic DDL transaction',()=>{
 const b=baseline();b.functions[0].ddl+='\n-- synthetic previous public definition';h.baseline=b
 const overlay=helper.installPoaContractTriggerProfile();overlay.restore()
 expect(h.statements).toHaveLength(2)
 for(const command of h.statements){
  expect(command).toContain('CREATE OR REPLACE FUNCTION public.')
  expect(command).toContain('REVOKE ALL ON FUNCTION public.')
  expect(command.indexOf('REVOKE ALL')).toBeLessThan(command.lastIndexOf('COMMIT;'))
 }
 expect(h.statements[1]).toContain('-- synthetic previous public definition')
})
it('adds and removes the six missing public functions with RESTRICT while retaining every protected object',()=>{
 const absent=new Set(['public.gridex_assert_company_operational_for_write()','public.gridex_audit_critical_row_change()','public.gridex_customer_contracts_company_guard()','public.set_updated_at()','public.gridex_assert_same_company(uuid, uuid, text, text)','public.gridex_add_months_timestamptz(timestamp with time zone, integer)'])
 const b=baseline();b.functions=b.functions.filter(f=>!absent.has(f.identity));h.baseline=b
 expect(plan(b).functions).toHaveLength(6)
 const overlay=helper.installPoaContractTriggerProfile();overlay.restore()
 expect(h.installed).toBe(false);expect(h.statements).toHaveLength(2)
 expect(h.statements[0].match(/CREATE OR REPLACE FUNCTION public\./g)).toHaveLength(6)
 expect(h.statements[1].match(/DROP FUNCTION public\.[^;]+ RESTRICT;/g)).toHaveLength(6)
 expect(h.statements[1]).not.toContain('CASCADE')
})
