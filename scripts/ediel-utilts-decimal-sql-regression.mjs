// Targeted embedded PostgreSQL check; not native/replay/type/schema evidence.
// EDIEL_PGLITE_MODULE points to pinned @electric-sql/pglite@0.3.14 temporary tooling.
import {pathToFileURL,fileURLToPath} from 'node:url'
const modulePath=process.env.EDIEL_PGLITE_MODULE
if(!modulePath) throw new Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(modulePath).href)
import fs from 'node:fs'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url))
const db=new PGlite()
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;
 create table public.ediel_messages(id uuid,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text);
 create table public.meter_reading_series(id uuid,company_id uuid,message_code text,source_transaction_reference text,source_ediel_message_id uuid,raw_transaction jsonb,immutable_hash text);
 create table public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,disposition text,persistence_status text,planned_response_type text,persisted_series_id uuid);
 create table gridex_utilts_binding.receipts(source_message_id uuid,company_id uuid,environment text,message_code text,raw_hash text,source_context jsonb,membership jsonb,contract_version int constraint receipts_contract_version_check check(contract_version=1),bound_at timestamptz);
 create table gridex_utilts_binding.contracts(series_id uuid,company_id uuid,environment text,source_message_id uuid,transaction_id text,contract_version int constraint contracts_contract_version_check check(contract_version=1),contract jsonb,contract_hash text);`)
const old=fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8')
await db.exec(old.slice(old.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),old.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
await db.exec(old.slice(old.indexOf('CREATE FUNCTION gridex_utilts_binding.exact_keys_v1'),old.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_v1')))
const validators=fs.readFileSync(root+'/supabase/migrations/20260923150649_ediel_utilts_bound_sink_authority.sql','utf8')
await db.exec(validators.slice(validators.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_base_v1'),validators.indexOf('-- Authoritative lookup')))
// The actual new migration compiles against the narrow inherited row types.
// This is a focused PostgreSQL integrity check, not native replay evidence.
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql','utf8'))
const skip={capability:'skip',reason:'no_attribution',customerId:null,siteId:null,customerSiteId:null,meteringPointId:null,gridOwnerId:null,sourceRequestId:null}
const c={version:2,projectionVersion:'utilts-consumption-v2',attributionVersion:'tenant-match-v1',companyId:'11111111-1111-1111-1111-111111111111',environment:'test',messageCode:'E66',transactionId:'OWN',seriesKind:'actual',profileKey:'utilts_e66',profileVersion:null,rulePackHash:null,guideRevision:'25-A-4',sourceType:'ediel_utilts',
 interpretation:{localPeriodStart:null,localPeriodEnd:null,localRegistration:null,resolutionValue:null,resolutionFormat:null,timezoneRaw:null,timezoneFormat:null,offsetMinutes:null,timestampPolicy:'explicit-offset-v1'},
 observations:[{ordinal:0,sourceOrdinal:0,quantity:'9007199254740993',periodStart:'2026-07-01T00:00:00.000Z',periodEnd:'2026-07-01T00:15:00.000Z',readAt:'2026-07-01T00:15:00.000Z',resolution:null,unit:'kWh',quality:null,readingType:'consumption',direction:'consumption',registerCode:null,productCode:null,sourceLineReference:null,externalPoint:null,gridArea:null}],metering:skip,
 billing:{...skip,requestScope:null,periodStart:null,periodEnd:null,month:null,year:null,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'},billingContributionOrdinals:[]}
let count=0
async function contract(value,expected){const {rows}=await db.query('select gridex_utilts_binding.validate_contract_v1($1::jsonb) valid',[JSON.stringify(value)]);assert.equal(rows[0].valid,expected,`check ${count} ${JSON.stringify(value)}`);count++}
await contract(c,true)
for(const q of [9007199254740993,'9007199254740992.0','01','-0','1e3','NaN',' 1']) await contract({...c,observations:[{...c.observations[0],quantity:q}]},false)
await contract({...c,version:1,projectionVersion:'utilts-consumption-v1',observations:[{...c.observations[0],quantity:7}]},true)
await contract({...c,observations:[{...c.observations[0],quantity:'0.000000000000000001'}]},true)
const {rows:wire}=await db.query("select gridex_utilts_binding.wire_tokens_v1($1) tokens",["UNH+1+UTILTS'IDE+24+OWN'MEA+AAZ++KWH'SEQ++1'QTY+136:9007199254740993'IDE+24+OTHER'QTY+136:9'UNT+8+1'"])
const tokens=wire[0].tokens
const item={transactionId:'OWN',disposition:'accepted',unit:'KWH',quantities:[{qualifier:'136',value:'9007199254740993'}],consumptionContract:c}
async function source(value,expected,t=tokens,mark='.'){const {rows}=await db.query('select gridex_utilts_binding.validate_decimal_source_v2($1::jsonb,$2::jsonb,$3) valid',[JSON.stringify(t),JSON.stringify(value),mark]);assert.equal(rows[0].valid,expected,`check ${count} ${JSON.stringify(value)}`);count++}
await source(item,true)
await source({...item,quantities:[{qualifier:'136',value:'9007199254740992'}]},false)
await source({...item,consumptionContract:{...c,observations:[{...c.observations[0],quantity:'9'}]}},false)
await source({...item,consumptionContract:{...c,observations:[{...c.observations[0],sourceOrdinal:1}]}},false)
const comma=structuredClone(tokens);comma[4].elements[1][1]='0,100000000000000001'
const commaContract={...c,observations:[{...c.observations[0],quantity:'0.100000000000000001'}]}
await source({...item,quantities:[{qualifier:'136',value:'0.100000000000000001'}],consumptionContract:commaContract},true,comma,',')
const mixed=structuredClone(tokens);mixed.splice(4,0,{index:3.5,tag:'MEA',elements:[['MEA'],['AAZ'],[''],['MWH']]})
await source(item,false,mixed)
const explicit=structuredClone(tokens);explicit[4].elements[1].push('MWH');await source(item,false,explicit)
const megawatt=structuredClone(tokens);megawatt[2].elements[3][0]='MWH'
await source({...item,unit:'MWH',consumptionContract:{...c,observations:[{...c.observations[0],quantity:'9007199254740993000'}]}},true,megawatt)
const absent=structuredClone(tokens);absent[4].elements[1]=['220','NULL']
await source({...item,quantities:[{qualifier:'220',value:null}],consumptionContract:{...c,observations:[]}},true,absent)
await source({...item,quantities:[{qualifier:'220',value:'0'}],consumptionContract:{...c,observations:[]}},false,absent)
const readingWithoutUnit=absent.filter(t=>t.tag!=='MEA')
await source({...item,unit:null,quantities:[{qualifier:'220',value:null}],consumptionContract:{...c,observations:[]}},true,readingWithoutUnit)
await source({...item,unit:null},false,tokens.filter(t=>t.tag!=='MEA'))
const request=tokens.filter(t=>!['MEA','SEQ','QTY'].includes(t.tag))
await source({...item,unit:null,quantities:[],consumptionContract:{...c,observations:[]}},true,request)
const legacy=await db.query('select gridex_utilts_binding.legacy_retry_item_v1($1::jsonb) item',[JSON.stringify(item)])
assert.equal(legacy.rows[0].item.consumptionContract.version,1);count++
assert.equal(legacy.rows[0].item.quantities[0].value,9007199254740992);count++
const access=await db.query("select has_function_privilege('authenticated','gridex_utilts_binding.validate_contract_v1(jsonb)','EXECUTE') allowed")
assert.equal(access.rows[0].allowed,false);count++
console.log(`Focused PostgreSQL compile/decimal/source/version/ACL checks: ${count} PASS`)
} finally {await db.close()}
