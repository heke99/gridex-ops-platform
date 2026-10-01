import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'

type PlanNode={['Node Type']:string;['Actual Rows']:number;['Index Name']?:string;Plans?:PlanNode[]}
type Explain={Plan:PlanNode;['Execution Time']:number;['Planning Time']:number}
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const indexes=(node:PlanNode):string[]=>[...(node['Index Name']?[node['Index Name']]:[]),...(node.Plans??[]).flatMap(indexes)]

/** Full disposable PostgreSQL schema only. These raw inbound originals are
 * synthetic query data, not qualified source/acceptance or readiness evidence.
 * Every production INSERT/capture trigger remains enabled; no new authority,
 * altered planner setting, disabled constraint or stub table is installed. */
it('measures actual tenant/environment/actor/deadline/reference and object/period/version/FK plans on unqualified native rows',()=>{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const first=randomUUID(),second=randomUUID(),head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 const draft=closureFixture({reason:'Z24'}).wire,tokens=tokenizeEdifact(draft),unb=tokens.segments.find(s=>s.tag==='UNB')!
 const parts=unb.raw.split('+');while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1'
 const wire=draft.replace(unb.raw,parts.join('+')),interchange=segmentComposite(unb,5,tokens.una)[0]
 const firstSource=randomUUID(),secondSource=randomUUID(),baseSeries=randomUUID(),currentSeries=randomUUID()
 const ownSeries=(version:number)=>`company_id=${literal(first)}::uuid AND series_kind='request' AND external_metering_point_id='synthetic-object-4242' AND grid_area_id='SYNTHETIC' AND period_start='2020-08-15T00:00:00Z' AND period_end='2020-08-16T00:00:00Z' AND version_no=${version}`
 const queries={
  queue:`SELECT id,status,created_at FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND environment='test' AND message_family='PRODAT' AND status='received' ORDER BY created_at DESC LIMIT 100`,
  reference:`SELECT id FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND direction='inbound' AND sender_ediel_id='12345' AND receiver_ediel_id='54321' AND interchange_reference='perf-4242'`,
  deadline:`SELECT id,contrl_due_at FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND environment='test' AND message_family='PRODAT' AND status='received' AND sender_ediel_id='12345' AND contrl_due_at<clock_timestamp() ORDER BY created_at DESC LIMIT 100`,
  objectPeriodVersion:`SELECT id,version_no,supersedes_series_id FROM public.meter_reading_series WHERE ${ownSeries(2)} AND is_current`,
  sourceForeignKey:`SELECT id FROM public.meter_reading_series WHERE source_ediel_message_id=${literal(firstSource)}::uuid`,
  supersededForeignKey:`SELECT id FROM public.meter_reading_series WHERE supersedes_series_id=${literal(baseSeries)}::uuid AND supersedes_series_id IS NOT NULL`,
  sourceHistory:`SELECT source_message_id,payload_hash,captured_at FROM gridex_received_sources.sources WHERE company_id=${literal(first)}::uuid AND environment='test' AND captured_at<=clock_timestamp() ORDER BY captured_at DESC LIMIT 100`,
 }
 const output=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input:`BEGIN;
   SET LOCAL statement_timeout='90s';
   INSERT INTO public.companies(id,name,status) VALUES(${literal(first)},'Synthetic query-plan owner A','active'),(${literal(second)},'Synthetic query-plan owner B','active');
   INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,sender_ediel_id,receiver_ediel_id,interchange_reference,created_at,contrl_due_at)
   SELECT CASE WHEN n=4242 THEN ${literal(firstSource)}::uuid WHEN n=4243 THEN ${literal(secondSource)}::uuid ELSE gen_random_uuid() END,CASE WHEN n%2=0 THEN ${literal(first)}::uuid ELSE ${literal(second)}::uuid END,'test','inbound','edifact','PRODAT','Z05','received',replace(${literal(wire)},${literal(interchange)},'perf-'||n),clock_timestamp(),'12345','54321','perf-'||n,clock_timestamp()-make_interval(secs=>n),clock_timestamp()-make_interval(secs=>n%3600)
   FROM generate_series(1,10000) n;
   -- Request metadata are deliberately unqualified: no meter values, legal
   -- supply, ready/accepted source facet, private persistence owner or invoice.
   INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,external_metering_point_id,grid_area_id,period_start,period_end,resolution,unit,quality_status,dedupe_key,series_kind,version_no,is_current,raw_transaction)
   SELECT CASE WHEN n=4242 THEN ${literal(baseSeries)}::uuid ELSE gen_random_uuid() END,m.company_id,
    m.id,'synthetic-object-'||n,'SYNTHETIC','2020-01-01T00:00:00Z'::timestamptz+make_interval(days=>n%365),'2020-01-02T00:00:00Z'::timestamptz+make_interval(days=>n%365),'UNKNOWN','KWH','received','perf-original-'||n,'request',1,false,jsonb_build_object('syntheticQueryMetadata',true,'authorizesBusinessEffects',false)
   FROM generate_series(1,10000) n JOIN public.ediel_messages m ON m.interchange_reference='perf-'||n AND m.company_id=CASE WHEN n%2=0 THEN ${literal(first)}::uuid ELSE ${literal(second)}::uuid END;
   INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,external_metering_point_id,grid_area_id,period_start,period_end,resolution,unit,quality_status,dedupe_key,series_kind,version_no,is_current,supersedes_series_id,raw_transaction)
   SELECT CASE WHEN id=${literal(baseSeries)}::uuid THEN ${literal(currentSeries)}::uuid ELSE gen_random_uuid() END,company_id,source_ediel_message_id,external_metering_point_id,grid_area_id,period_start,period_end,resolution,unit,quality_status,replace(dedupe_key,'perf-original-','perf-current-'),'request',2,true,id,raw_transaction
   FROM public.meter_reading_series WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid) AND dedupe_key LIKE 'perf-original-%';
   ANALYZE public.meter_reading_series;
   ANALYZE public.ediel_messages;
   ANALYZE gridex_received_sources.sources;
   CREATE FUNCTION pg_temp.query_plan(query text) RETURNS jsonb LANGUAGE plpgsql AS $plan$
   DECLARE result jsonb; BEGIN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '||query INTO result; RETURN result->0; END $plan$;
   SELECT jsonb_build_object('plans',jsonb_build_object(${Object.entries(queries).map(([key,query])=>`${literal(key)},pg_temp.query_plan(${literal(query)})`).join(',')}),
    'counts',(SELECT jsonb_object_agg(company_id,n) FROM(SELECT company_id,count(*) n FROM public.ediel_messages WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid) GROUP BY company_id)c),
    'captured',(SELECT count(*) FROM gridex_received_sources.sources WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid)),
    'seriesCounts',(SELECT jsonb_object_agg(company_id,n) FROM(SELECT company_id,count(*) n FROM public.meter_reading_series WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid) GROUP BY company_id)c),
    'measurementValues',(SELECT count(*) FROM public.meter_reading_values WHERE company_id IN(${literal(first)}::uuid,${literal(second)}::uuid)),
    'wrongEnvironment',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND environment='production'),
    'objectRevision',(SELECT jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'version',version_no,'current',is_current,'supersedes',supersedes_series_id)) FROM public.meter_reading_series WHERE company_id=${literal(first)}::uuid AND external_metering_point_id='synthetic-object-4242'),
    'sourceForeignKeyLeak',(SELECT count(*) FROM public.meter_reading_series WHERE company_id=${literal(second)}::uuid AND source_ediel_message_id=${literal(firstSource)}::uuid),
    'scopeLeak',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(first)}::uuid AND interchange_reference='perf-4243'),
    'indexes',(SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE (schemaname,tablename) IN(('public','ediel_messages'),('public','meter_reading_series'),('gridex_received_sources','sources'))),
    'triggers',(SELECT jsonb_object_agg(tgrelid::regclass::text||'.'||tgname,tgenabled) FROM pg_trigger WHERE tgrelid IN('public.ediel_messages'::regclass,'public.meter_reading_series'::regclass) AND NOT tgisinternal));
   ROLLBACK;`,encoding:'utf8',timeout:120000,maxBuffer:2_000_000,
 }).trim()
 const evidence=JSON.parse(output) as {plans:Record<keyof typeof queries,Explain>;counts:Record<string,number>;captured:number;scopeLeak:number;seriesCounts:Record<string,number>;measurementValues:number;wrongEnvironment:number;sourceForeignKeyLeak:number;objectRevision:Array<{id:string;companyId:string;version:number;current:boolean;supersedes:string|null}>;indexes:Record<string,string>;triggers:Record<string,string>}
 // Record actual native plans even when a bound below fails.
 console.log(JSON.stringify({kind:'ediel_transport_data_native_query_plans',head,observedAt:new Date().toISOString(),dataset:{synthetic:true,originalRows:10000,requestMetadataRows:20000,companies:2,qualifiedSources:false,acceptedMeasurements:false,deadlineMetadataOnly:true},queries,...evidence}))
 expect(evidence.counts).toEqual({[first]:5000,[second]:5000})
 expect(evidence.seriesCounts).toEqual({[first]:10000,[second]:10000});expect(evidence.measurementValues).toBe(0);expect(evidence.wrongEnvironment).toBe(0);expect(evidence.sourceForeignKeyLeak).toBe(0)
 expect(evidence.objectRevision).toEqual(expect.arrayContaining([{id:baseSeries,companyId:first,version:1,current:false,supersedes:null},{id:currentSeries,companyId:first,version:2,current:true,supersedes:baseSeries}]))
 expect(evidence.captured).toBe(10000);expect(evidence.scopeLeak).toBe(0)
 expect(Object.keys(evidence.triggers).some(name=>name.endsWith('.meter_reading_series_tenant_guard'))).toBe(true)
 expect(Object.keys(evidence.triggers).some(name=>name.endsWith('.meter_reading_series_immutable_guard'))).toBe(true)
 expect(Object.values(evidence.triggers).every(state=>state==='O'||state==='A')).toBe(true)
 const rows={queue:100,reference:1,sourceHistory:100,deadline:100,objectPeriodVersion:1,sourceForeignKey:2,supersededForeignKey:1}
 const expected={queue:'ediel_messages_company_family_status_idx',reference:'ediel_messages_company_direction_ref_idx',sourceHistory:'received_sources_original_scope_cutoff_idx',deadline:'ediel_messages_company_family_status_idx',objectPeriodVersion:'meter_reading_series_current_object_period_idx',sourceForeignKey:'meter_reading_series_source_message_idx',supersededForeignKey:'meter_reading_series_supersedes_idx'}
 for(const key of Object.keys(queries) as (keyof typeof queries)[]){
  expect(evidence.plans[key].Plan['Actual Rows']).toBe(rows[key])
  expect(evidence.indexes).toHaveProperty(expected[key])
  expect(indexes(evidence.plans[key].Plan)).toContain(expected[key])
  expect(evidence.plans[key]['Execution Time']).toBeLessThan(500)
 }

},120000)
