import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'

type PlanNode={['Node Type']:string;['Index Name']?:string;Plans?:PlanNode[]}
type Explain={Plan:PlanNode;['Execution Time']:number;['Planning Time']:number}
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const indexes=(node:PlanNode):string[]=>[...(node['Index Name']?[node['Index Name']]:[]),...(node.Plans??[]).flatMap(indexes)]

/** Full disposable PostgreSQL schema only. These raw inbound originals are
 * synthetic query data, not qualified source/acceptance or readiness evidence.
 * Every production INSERT/capture trigger remains enabled; no new authority,
 * altered planner setting, disabled constraint or stub table is installed. */
it('measures actual tenant/status/reference/source-ledger plans on 10000 native captured originals',()=>{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const first=randomUUID(),second=randomUUID(),head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 const wire=closureFixture({reason:'Z24'}).wire
 const queries={
  queue:`SELECT id,status,created_at FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND message_family='PRODAT' AND status='received' ORDER BY created_at DESC LIMIT 100`,
  reference:`SELECT id FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND direction='inbound' AND sender_ediel_id='12345' AND receiver_ediel_id='54321' AND interchange_reference='perf-4242'`,
  sourceHistory:`SELECT source_message_id,payload_hash,captured_at FROM gridex_received_sources.sources WHERE company_id=${literal(first)}::uuid AND environment='test' AND captured_at<=clock_timestamp() ORDER BY captured_at DESC LIMIT 100`,
 }
 const output=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input:`BEGIN;
   SET LOCAL statement_timeout='90s';
   INSERT INTO public.companies(id,name,status) VALUES(${literal(first)},'Synthetic query-plan owner A','active'),(${literal(second)},'Synthetic query-plan owner B','active');
   INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,sender_ediel_id,receiver_ediel_id,interchange_reference,created_at)
   SELECT gen_random_uuid(),CASE WHEN n%2=0 THEN ${literal(first)}::uuid ELSE ${literal(second)}::uuid END,'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},clock_timestamp(),'12345','54321','perf-'||n,clock_timestamp()-make_interval(secs=>n)
   FROM generate_series(1,10000) n;
   ANALYZE public.ediel_messages;
   ANALYZE gridex_received_sources.sources;
   CREATE FUNCTION pg_temp.query_plan(query text) RETURNS jsonb LANGUAGE plpgsql AS $plan$
   DECLARE result jsonb; BEGIN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '||query INTO result; RETURN result->0; END $plan$;
   SELECT jsonb_build_object('plans',jsonb_build_object(${Object.entries(queries).map(([key,query])=>`${literal(key)},pg_temp.query_plan(${literal(query)})`).join(',')}),
    'counts',(SELECT jsonb_object_agg(company_id,n) FROM(SELECT company_id,count(*) n FROM public.ediel_messages WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid) GROUP BY company_id)c),
    'captured',(SELECT count(*) FROM gridex_received_sources.sources WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid)),
    'scopeLeak',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND interchange_reference='perf-4243'),
    'indexes',(SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE (schemaname,tablename) IN(('public','ediel_messages'),('gridex_received_sources','sources'))),
    'triggers',(SELECT jsonb_object_agg(tgname,tgenabled) FROM pg_trigger WHERE tgrelid='public.ediel_messages'::regclass AND NOT tgisinternal));
   ROLLBACK;`,encoding:'utf8',timeout:120000,maxBuffer:2_000_000,
 }).trim()
 const evidence=JSON.parse(output) as {plans:Record<keyof typeof queries,Explain>;counts:Record<string,number>;captured:number;scopeLeak:number;indexes:Record<string,string>;triggers:Record<string,string>}
 expect(evidence.counts).toEqual({[first]:5000,[second]:5000})
 expect(evidence.captured).toBe(10000);expect(evidence.scopeLeak).toBe(0)
 expect(Object.values(evidence.triggers).every(state=>state==='O'||state==='A')).toBe(true)
 const expected={queue:'ediel_messages_company_family_status_idx',reference:'ediel_messages_company_direction_ref_idx',sourceHistory:'received_sources_original_scope_cutoff_idx'}
 for(const key of Object.keys(queries) as (keyof typeof queries)[]){
  expect(evidence.indexes).toHaveProperty(expected[key])
  expect(indexes(evidence.plans[key].Plan)).toContain(expected[key])
  expect(evidence.plans[key]['Execution Time']).toBeLessThan(500)
 }
 // Metadata and unredacted synthetic plans only: no credentials or personal data.
 console.log(JSON.stringify({kind:'ediel_transport_data_native_query_plans',head,observedAt:new Date().toISOString(),dataset:{synthetic:true,rows:10000,companies:2,qualifiedSources:false},queries,...evidence}))
},120000)
