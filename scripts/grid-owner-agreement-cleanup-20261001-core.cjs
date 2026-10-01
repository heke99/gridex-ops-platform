const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {fixture:agreementFixture}=require('./grid-owner-agreement-atomic-20261001-core.cjs')
const migration='20261001030647_grid_owner_agreement_durable_cleanup.sql'
async function fixture(options={}){
  const f=await agreementFixture(options)
  try{
    let legacy
    if(options.legacyReference){
      const payload={...f.command.payload,documentFile:{bucket:'grid-owner-agreements',name:'owned.pdf',sha256:'a'.repeat(64)}}
      const prepared=await f.execute({operation:'prepare_upload',payload})
      const saved=await f.execute({idempotencyKey:'legacy-manual-reference-0001',payload:{...f.command.payload,documentPath:prepared.intent.bucket+':'+prepared.intent.path}})
      legacy={prepared,saved}
    }
    await f.db.exec('reset role')
    const sql=readFileSync(resolve(__dirname,'../supabase/migrations',migration),'utf8')
    if(sql.trim())await f.db.exec(sql)
    await f.db.exec('set role service_role')
    const payload={...f.command.payload,documentFile:{bucket:'grid-owner-agreements',name:'owned.pdf',sha256:'a'.repeat(64),size:20,contentType:'application/pdf'}}
    const prepare=()=>f.execute({operation:'prepare_upload',payload})
    const claim=(companyId=f.id(1),token=f.id(30),limit=10)=>f.db.query('select public.gridex_claim_agreement_cleanup_v1($1::uuid,$2::uuid,$3::integer) as result',[companyId,token,limit]).then(r=>r.rows[0].result)
    const finish=(receipt,outcome='removed')=>f.db.query('select public.gridex_finish_agreement_cleanup_v1($1::jsonb,$2::text) as result',[JSON.stringify(receipt),outcome]).then(r=>r.rows[0].result)
    const validate=receipt=>f.db.query('select public.gridex_validate_agreement_cleanup_v1($1::jsonb) as result',[JSON.stringify(receipt)]).then(r=>r.rows[0].result)
    const cleanupSnapshot=()=>f.root("select jsonb_build_object('uploads',(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]') from private.gridex_agreement_uploads_v1 u),'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by upload_intent_id),'[]') from private.gridex_agreement_cleanup_claims_v1 c),'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from private.gridex_agreement_cleanup_events_v1 e)) as value").then(r=>r.rows[0].value)
    return {...f,payload,prepare,claim,finish,validate,cleanupSnapshot,legacy}
  }catch(error){await f.db.close();throw error}
}
module.exports={fixture,migration}
