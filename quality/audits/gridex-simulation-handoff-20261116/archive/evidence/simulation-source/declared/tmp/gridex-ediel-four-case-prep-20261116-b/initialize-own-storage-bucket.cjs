'use strict';
// Fixed producer-only fixture step through real own Storage SDK; no user Auth.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const ROOT='/tmp/gridex-ediel-four-case-actual-20261116-b';
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 if(process.argv.length!==3||process.argv[2]!==ROOT+'/storage-bucket-input.private.json')throw Error('FIXED_OWN_STORAGE_FIXTURE_INPUT');
 const p=process.argv[2],st=fs.lstatSync(p);if(!st.isFile()||fs.realpathSync(p)!==p||(st.mode&511)!==384||st.size>2097152)throw Error('PRIVATE_REAL_INPUT');
 const C=JSON.parse(fs.readFileSync(p));if(C.state!=='BOUND_OWN_REAL_STORAGE_BUCKET_FIXTURE_ONLY'||C.origin!=='http://127.0.0.1:3169'||Date.now()>=C.deadlineEpoch*1000)throw Error('FIXED_OWN_STORAGE_FIXTURE');
 for(const r of[C.carrier,C.initializer])if(H(fs.readFileSync(r.path))!==r.sha256)throw Error('FROZEN_INPUT_HASH');
 const keys=JSON.parse(fs.readFileSync(C.carrier.path));const{createClient}=require('/tmp/gridex-scenario-source-442256/node_modules/@supabase/supabase-js');
 const guardedFetch=async(input,init)=>{const req=new Request(input,init),u=new URL(req.url);if(u.origin!==C.origin||u.search||!['/storage/v1/bucket/ediel-files','/storage/v1/bucket'].includes(u.pathname)||!['GET','POST'].includes(req.method))throw Error('FIXED_OWN_BUCKET_SDK_ONLY');return fetch(req,{redirect:'error',signal:AbortSignal.timeout(15000)})};
 const service=createClient(C.origin,keys.serviceRoleKey,{global:{fetch:guardedFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const result=await require(C.initializer.path).ensureOwnArchiveBucket(service);process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module)main().catch(e=>{process.stderr.write(JSON.stringify({errorClass:e?.name??'Error',state:'OWN_BUCKET_FIXTURE_STOP_NO_RETRY'})+'\n');process.exitCode=1});
