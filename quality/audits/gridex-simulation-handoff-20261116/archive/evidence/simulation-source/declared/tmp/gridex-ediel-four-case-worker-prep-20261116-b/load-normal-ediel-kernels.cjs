'use strict';
// Fixed Node server-only composition. Does not start a server or authenticate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const must=(v,m)=>{if(!v)throw Error(m)},H=b=>crypto.createHash('sha256').update(b).digest('hex');
const P=__dirname,S='/workspace/gridex-pilot65-source-20261115-k11',NM='/tmp/gridex-scenario-source-442256/node_modules';
const MANIFEST='/tmp/gridex-source65-k11-materializer-prep-20261115/ACTUAL-FULL-2193.safe.json';
const ADAPTER='/workspace/gridex-ediel06-queued-fixture-20261116/own-segment-queue.ts';
let installed=null;
function install(){
 if(installed)return installed;
 must(process.execArgv.includes('--conditions=react-server'),'REAL_REACT_SERVER_CONDITION_REQUIRED');
 const markerPackage=JSON.parse(fs.readFileSync(NM+'/next/dist/compiled/server-only/package.json'));must(markerPackage.name==='server-only'&&markerPackage.exports['.']['react-server']==='./empty.js','REAL_NEXT_BUNDLED_SERVER_MARKER_EXPORT');
 const m=fs.readFileSync(MANIFEST);must(H(m)==='26869dc9f2fe332292ea6388243ef74a15fa7ef306c329bec99599e18fc7fe31','PINNED_FULL_SOURCE_MAP_REQUIRED');
 const rows=JSON.parse(m).files;must(rows.length===2193,'FULL2193_REQUIRED');const expected=new Map(rows.map(r=>[path.join(S,r.path),r]));
 const ts=require(NM+'/typescript');const resolve=Module._resolveFilename,loaded=[];const ownRequire=Module.createRequire(path.join(P,'load-closed-runtime.cjs'));
 Module._resolveFilename=function(request,parent,isMain,options){
  if(request==='server-only')return resolve.call(this,NM+'/next/dist/compiled/server-only/empty.js',parent,isMain,options);
  // The installed Next server-layer compiler maps navigation to this real server API.
  // Its dist/api entry re-exports the same CommonJS implementation below.
  if(request==='next/navigation')return resolve.call(this,NM+'/next/dist/client/components/navigation.react-server.js',parent,isMain,options);
  if(request.startsWith('@/'))request=path.join(S,request.slice(2));
  if(parent&&Array.isArray(parent.paths)){for(const q of [path.join(P,'node_modules'),NM])if(!parent.paths.includes(q))parent.paths.unshift(q)}
  const resolved=resolve.call(this,request,parent,isMain,options);
  return resolved;
 };
 const compile=(mod,filename)=>{
  const raw=fs.readFileSync(filename);if(filename.startsWith(S+'/')){const r=expected.get(filename);must(r&&r.bytes===raw.length&&r.sha256===H(raw),'IMPORTED_ORIGINAL_SOURCE_DRIFT')}
  else must(filename===ADAPTER&&H(raw)==='fd4e7a47ff051882348be25fa352839b9ea18b82f6481b88e0052b97160b2bf7','EXACT_UNCHANGED_OWN_SEGMENT_ADAPTER');
  const output=ts.transpileModule(raw.toString('utf8'),{fileName:filename,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,isolatedModules:true}});
  must(!(output.diagnostics??[]).some(x=>x.category===ts.DiagnosticCategory.Error),'TYPESCRIPT_TRANSPILATION_DIAGNOSTIC');
  loaded.push({path:filename,sha256:H(raw),bytes:raw.length});mod._compile(output.outputText,filename);
 };
 Module._extensions['.ts']=compile;Module._extensions['.tsx']=compile;
 const marker=ownRequire.resolve('server-only');must(marker.endsWith('/empty.js'),'REAL_SERVER_ONLY_CONDITIONAL_EXPORT_REQUIRED');
 ownRequire('server-only');installed={loaded,serverOnlyResolved:marker,typescriptVersion:ts.version};return installed;
}
function load(){
 const facts=install();
 const bootstrap=require(S+'/lib/inbound-mail/edielMailboxPoller.part-1.ts').bootstrapSharedMailboxFromEnv;
 const mail=require(S+'/lib/inbound-mail/edielMailboxPoller.ts'),receptions=require(S+'/lib/ediel/inbound/receptions.ts');
 const receiver=require(S+'/lib/ediel/testing/controlledTestReceiverIdentity.ts'),utilts=require(S+'/lib/ediel/utilts.ts');
 const grammar=require(S+'/lib/ediel/core/unsmGrammar.ts'),parser=require(S+'/lib/inbound-mail/edielEmailParser.ts');
 const headerNegative=require(S+'/lib/inbound-mail/prodatAssignedHeaderRejectionIntake.ts');
 const inbound=require(S+'/lib/inbound-mail/edielInboundProcessor.ts'),canonical=require(S+'/lib/ediel/flows/inboundProcessing.ts');
 const outbox=require(S+'/lib/ediel/outbox/sendOutboxItem.ts'),routes=require(S+'/lib/cis/db-routes.ts');
 const authorization=require(S+'/lib/ediel/services/authorization.ts'),governance=require(S+'/lib/tenant/governance.ts');
 const invalidation=require(S+'/lib/ediel/testing/retestInvalidation.ts');
 must(typeof bootstrap==='function'&&typeof mail.pollEdielMailbox==='function'&&typeof mail.processQueuedInboundProcessingJobs==='function'&&typeof receiver.issueControlledTestReceiverIdentity==='function'&&typeof canonical.processInboundEdielMessage==='function'&&typeof outbox.sendOutboxItem==='function','ORIGINAL_FOUR_CASE_EXPORTS_REQUIRED');
 return{facts,bootstrap,mail,receptions,receiver,utilts,grammar,parser,headerNegative,inbound,canonical,outbox,routes,authorization,governance,invalidation};
}
module.exports={install,load};
