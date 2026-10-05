// masterplan: SC-016
// Real embedded source/grant effects and executed production TS consumers.
// Upstream ports are explicitly synthetic; no native/legal acceptance inferred.
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {beforeAll,describe,expect,it} from 'vitest'

type Proof={checks:number;scope:string;source:{status:string;manifestObjects:string[];sites:string[];committedEffects:number;sourceHash:string;registryUnchanged:boolean;rawAndSealUnchanged:boolean;idempotentReplay:boolean;noAutomaticGrant:boolean};callers:{automatic:boolean;sdk:boolean;manual:boolean;hostileManualSitesIgnored:boolean;foreignAndInactiveHeld:boolean;sourceOnlyRpc:boolean};grant:{activeObjects:string[];separateApprovalRequired:boolean;refused:{objects:string[];status:string;missing:string[];accessGranted:boolean}[]};owners:{signature:string;migration:string;lastExplicitDefinition:string;definitionSha256:string;installedBodySha256:string;exactBody:boolean}[]}
let proof:Proof
beforeAll(()=>{
 const env={...process.env}
 // The SQL runner changes cwd; retain CI's guard using its repository path.
 if(env.NODE_OPTIONS)env.NODE_OPTIONS=env.NODE_OPTIONS.replaceAll('--require=./scripts/lib/unit-loopback-network-boundary.cjs',`--require=${JSON.stringify(resolve('scripts/lib/unit-loopback-network-boundary.cjs'))}`)
 const run=spawnSync(process.execPath,[resolve('scripts/ediel-sc-016-approved-object-sql-regression.mjs')],{cwd:process.cwd(),env,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024})
 expect(run.error,run.stderr).toBeUndefined()
 expect(run.status,run.stdout+'\n'+run.stderr).toBe(0)
 const lines=run.stdout.split('\n').filter(line=>line.startsWith('SC016_RESULT '))
 expect(lines).toHaveLength(1)
 proof=JSON.parse(lines[0].slice('SC016_RESULT '.length)) as Proof
},65000)
describe('SC-016 literal multi-object permission membership (finite SQL)',()=>{
 it('commits only Z14-approved A from Z13 A/B/C without customer-registry expansion',()=>{
  expect(proof.source).toMatchObject({status:'partially_approved',manifestObjects:['735123456789012345'],sites:['735123456789012345'],committedEffects:1,registryUnchanged:true,rawAndSealUnchanged:true,idempotentReplay:true,noAutomaticGrant:true})
  expect(proof.source.sourceHash).toMatch(/^[a-f0-9]{64}$/)
  expect(proof.owners).toHaveLength(4)
  for(const owner of proof.owners){expect(owner.exactBody).toBe(true);expect(owner.migration.endsWith(owner.lastExplicitDefinition)).toBe(true);expect(owner.definitionSha256).toMatch(/^[a-f0-9]{64}$/);expect(owner.installedBodySha256).toMatch(/^[a-f0-9]{64}$/)}
 })
 it('publishes only A after separate approval and holds B, C and A/B/C grants',()=>{
  expect(proof.grant.activeObjects).toEqual(['735123456789012345'])
  expect(proof.grant.separateApprovalRequired).toBe(true)
  expect(proof.grant.refused.map(row=>row.objects)).toEqual([['735123456789012352'],['735123456789012369'],['735123456789012345','735123456789012352','735123456789012369']])
  for(const row of proof.grant.refused)expect(row).toMatchObject({status:'held',missing:['explicit_approved_object_product_period'],accessGranted:false})
 })
 it('executes automatic, SDK and manual callers with source-only authority and real actor refusals',()=>{
  expect(proof.callers).toMatchObject({automatic:true,sdk:true,manual:true,hostileManualSitesIgnored:true,foreignAndInactiveHeld:true,sourceOnlyRpc:true})
  expect(proof.checks).toBeGreaterThanOrEqual(10)
  expect(proof.scope).toContain('NOT native/authentic acceptance')
 })
})
