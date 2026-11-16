'use strict';
// Execute only the exact existing pure file guard, plus optionally the actual
// worker's closed target/native/CA prefix that precedes const goPath. No GO,
// SDK, login, command module, listener or worker main executes here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const ROOT='/tmp/gridex-ediel-four-case-actual-20261116-b',AUTH='http://127.0.0.1:55321',REST='http://127.0.0.1:3168',DB='gridex_local_partner_http_20261113_a';
const ACTOR='ee029de5-22a8-4916-9c36-388d13f19cb1',COMPANY='b36f6a30-18cd-4a70-8652-5b2da9b4eb64';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),need=(v,m)=>{if(!v)throw Error(m)};
function inspector(){
 const source=fs.readFileSync(__dirname+'/normal-four-case-worker.v3.cjs','utf8'),lines=source.split('\n').filter(l=>l.startsWith('function bytes(r,own=false){'));need(lines.length===1&&lines[0].endsWith('}'),'ONE_ACTUAL_CLOSED_BYTES_GUARD');
 const scope={fs,path,H,need,ROOT,AUTH,REST,DB,ACTOR,COMPANY};
 const bytes=vm.runInNewContext(lines[0]+'\nbytes',scope,{timeout:1000});const read=(r,own=false)=>JSON.parse(bytes(r,own));
 function inspect(target,full=false){
  const C=JSON.parse(fs.readFileSync(target)),checked=[],failures=[],dynamicRefsAbsent=[];
  const refs=C.boundFiles.map((r,i)=>({field:'boundFiles['+i+']',r,own:false}));
  for(const[field,own]of[['sourceFreeze',false],['mainBeforeAuth',true],['all7BeforeAuth',true],['nativePrerequisites',true],['actorCredential',false],['serverKeys',false],['mailTlsCA',false]])if(C[field]==null)dynamicRefsAbsent.push(field);else refs.push({field,r:C[field],own});
  for(const x of refs){try{bytes(x.r,x.own);checked.push({field:x.field,path:x.r.path})}catch(e){failures.push({field:x.field,path:x.r?.path??null,guardName:e.message??e.name})}}
  let actualPrefixExecuted=false;
  if(full&&failures.length===0){try{
   need(dynamicRefsAbsent.length===0,'ALL_FULL_ACTUAL_REFS_PHYSICAL');
   const a=source.indexOf('async function main(){')+'async function main(){'.length,b=source.indexOf(' const goPath=',a);need(a>25&&b>a,'EXACT_CLOSED_PREAUTH_PREFIX');const prefix=source.slice(a,b);
   need(!/login\.intent|signInWithPassword|createClient\(|require\(/.test(prefix),'PREFIX_ENDS_BEFORE_ANY_AUTH_OR_SDK');
   // Planned launch environment only. Outer binds this same byte-exact CA path
   // into the eventual real Node launch; no claim a worker already exists.
   const plannedProcess={argv:['node',__dirname+'/normal-four-case-worker.v3.cjs',path.resolve(target)],env:{...process.env,NODE_EXTRA_CA_CERTS:C.mailTlsCA.path}};
   vm.runInNewContext('(function(){'+prefix+';return true;})()', {...scope,bytes,read,process:plannedProcess},{timeout:2000});actualPrefixExecuted=true;
  }catch(e){failures.push({field:'actualWorkerPreAuthPrefix',path:path.resolve(target),guardName:e.message??e.name})}}
  return{state:'ACTUAL_WORKER_TARGET_FILE_AND_PREFIX_PREFLIGHT_NOT_AUTHORITY',targetPath:path.resolve(target),targetSHA256:H(fs.readFileSync(target)),passed:failures.length===0,checkedCount:checked.length,checked,failures,dynamicRefsAbsent,fullActualMode:full,actualPrefixExecuted,plannedExtraCAEnvironmentOnly:full,authCalls:0,apiCalls:0,workerMainExecuted:false,authorityGranted:false};
 }
 return{bytes,inspect,helperSHA256:H(Buffer.from(lines[0]))};
}
module.exports={inspector};
if(require.main===module){let v;try{need([4,5].includes(process.argv.length)&&process.argv[2]==='--target'&&(process.argv.length===4||process.argv[4]==='--full-actual'),'FIXED_VALIDATOR_ARGUMENTS');v=inspector().inspect(process.argv[3],process.argv.includes('--full-actual'))}catch(e){v={state:'TARGET_PREFLIGHT_STOP',passed:false,guardName:e.message??e.name,authCalls:0,apiCalls:0}}process.stdout.write(JSON.stringify(v)+'\n');process.exitCode=v.passed?0:1;}
