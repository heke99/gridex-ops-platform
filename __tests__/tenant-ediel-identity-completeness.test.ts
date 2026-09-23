import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,count:null as number|null|undefined,options:[] as unknown[],limits:[] as number[],signals:[] as AbortSignal[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const q={select:(_columns:string,options?:unknown)=>{io.options.push(options);return q},eq:()=>q,
 limit:(n:number)=>{io.limits.push(n);return q},abortSignal:(signal:AbortSignal)=>{io.signals.push(signal);return q},
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:io.rows[table]??[],count:io.count===undefined?(io.rows[table]??[]).length:io.count,error:null}).then(resolve)};return q
}}}))
import {resolveCanonicalTenantEdielIdentityWithEvidence} from '@/lib/ediel/tenant/tenantEdielIdentity'
const input={companyId:'company',environment:'test' as const,asOf:'2026-09-22T12:00:00Z',requireExactCounts:true}
beforeEach(()=>{const scope={company_id:'company',environment:'test',valid_from:'2026-01-01T00:00:00Z',valid_to:null};io.rows={tenant_ediel_profiles:[{...scope,id:'profile',market:'electricity',is_enabled:true}],tenant_actor_identifiers:[{...scope,id:'identifier',actor_id:'actor',identifier_type:'EdielId',identifier_value:'54321'}],tenant_actor_roles:[{...scope,id:'role',actor_id:'actor',role_code:'electricity_supplier'}],tenant_counterparty_relations:[]};io.count=undefined;io.options=[];io.limits=[];io.signals=[]})
it('reports exact-count completeness only after each actual bounded query confirms it',async()=>{
 const value=await resolveCanonicalTenantEdielIdentityWithEvidence(input)
 expect(value.evidence).toMatchObject({completeness:'exact_count',completedAt:expect.any(String),historicalKnowledge:'not_established',consistency:'independent_reads'})
 expect(io.options).toEqual(Array(4).fill({count:'exact'}));expect(io.limits).toEqual(Array(4).fill(8193));expect(io.signals).toHaveLength(4)
})
it.each([null,0,2,8193])('withholds identity evidence on missing, truncated or over-budget count %s',async count=>{io.count=count;await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('tenant_ediel_evidence_incomplete')})
it('rejects duplicate physical rows instead of accepting a falsely complete set',async()=>{io.rows.tenant_ediel_profiles.push({...io.rows.tenant_ediel_profiles[0]});await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('tenant_ediel_evidence_incomplete')})
