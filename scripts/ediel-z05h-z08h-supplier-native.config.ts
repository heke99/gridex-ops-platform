import {createHash} from 'node:crypto'
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defineConfig} from 'vitest/config'
import type {Reporter} from 'vitest/reporters'
import owner from './ediel-source-owner-native.config'

type NativeCase=Parameters<NonNullable<Reporter['onTestCaseResult']>>[0]
type NativeRun=Parameters<NonNullable<Reporter['onTestRunEnd']>>
function publicErrorField(error:unknown,key:string){
 if(!error||typeof error!=='object')return undefined
 const value=Object.getOwnPropertyDescriptor(error,key)?.value
 if(typeof value!=='string')return undefined
 const hash=createHash('sha256')
 let bytes=0
 for(let offset=0;offset<value.length;){
  let end=Math.min(offset+8192,value.length)
  // Keep a UTF16 surrogate pair together so the streamed digest is exactly
  // SHA256 of the original string's UTF8 bytes, including non-BMP characters.
  if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff
   &&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end--
  const chunk=value.slice(offset,end);hash.update(chunk);bytes+=Buffer.byteLength(chunk);offset=end
 }
 return {characters:value.length,bytes,sha256:hash.digest('hex'),truncated:value.length>8192,
  first:value.slice(0,4096),last:value.length>4096?value.slice(-4096):''}
}
function boundedError(error:unknown){
 return Object.fromEntries(['name','code','message','stack','stderr','diff'].map(key=>[key,publicErrorField(error,key)]))
}
function xml(value:string){
 // XML1.0 forbids some controls even in escaped failure text.
 return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'?')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&apos;')
}
/** Observe actual completed results only. Full comparisons and their original
 * errors remain in Vitest; bounded copies prevent huge assertion hints or SQL
 * stdout in error messages from overwhelming log/JUnit redaction. */
export class BoundedHNativeReporter implements Reporter {
 private readonly directory=process.env.GRIDEX_H_REPORT_DIRECTORY??'h05h08-native-working'
 private packet(test:NativeCase){
  const result=test.result()
  return {id:test.id,name:test.fullName,module:test.module.relativeModuleId,
   location:test.location,state:result.state,durationMs:test.diagnostic()?.duration??0,
   errors:(result.errors??[]).map(boundedError)}
 }
 onTestRunStart(){
  mkdirSync(this.directory,{recursive:true})
  writeFileSync(join(this.directory,'native-cases.ndjson'),'')
 }
 onTestCaseResult(test:NativeCase){
  const packet=this.packet(test)
  appendFileSync(join(this.directory,'native-cases.ndjson'),JSON.stringify(packet)+'\n')
  console.log('H05H08_CASE '+JSON.stringify(packet))
 }
 onUserConsoleLog(log:Parameters<NonNullable<Reporter['onUserConsoleLog']>>[0]){
  console.log('H05H08_LOG '+JSON.stringify({type:log.type,taskId:log.taskId,
   content:publicErrorField({content:log.content},'content')}))
 }
 onTestRunEnd(modules:NativeRun[0],unhandled:NativeRun[1],reason:NativeRun[2]){
  const cases=modules.flatMap(module=>[...module.children.allTests()].map(test=>this.packet(test)))
  const outside=[...unhandled,...modules.flatMap(module=>[...module.errors(),
   ...[...module.children.allSuites()].flatMap(suite=>suite.errors())])].map(boundedError)
  const counts={tests:cases.length,passed:cases.filter(test=>test.state==='passed').length,
   failures:cases.filter(test=>test.state==='failed').length,
   skipped:cases.filter(test=>test.state==='skipped'||test.state==='pending').length,errors:outside.length,reason}
  const target=join(this.directory,'native-junit.xml')
  writeFileSync(target,`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${counts.tests}" failures="${counts.failures}" skipped="${counts.skipped}" errors="${counts.errors}">\n<testsuite name="actual H native" tests="${counts.tests}" failures="${counts.failures}" skipped="${counts.skipped}" errors="${counts.errors}">\n`)
  for(const test of cases){
   appendFileSync(target,`<testcase name="${xml(test.name)}" classname="${xml(test.module)}" time="${test.durationMs/1000}">\n`)
   if(test.state==='failed')appendFileSync(target,`<failure message="Actual test failed; bounded details and original message digests follow">${xml(JSON.stringify(test.errors))}</failure>\n`)
   if(test.state==='skipped'||test.state==='pending')appendFileSync(target,'<skipped/>\n')
   appendFileSync(target,'</testcase>\n')
  }
  if(outside.length)appendFileSync(target,`<system-err>${xml(JSON.stringify(outside))}</system-err>\n`)
  appendFileSync(target,'</testsuite>\n</testsuites>\n')
  writeFileSync(join(this.directory,'native-summary.json'),JSON.stringify({counts,outside},null,2)+'\n')
  console.log('H05H08_RESULT '+JSON.stringify(counts))
 }
}

// Genuine public reception only; inherited local ownership and permission setup.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 // Failure formatting only: compare the complete values and retain every
 // test/assertion/outcome, while avoiding multi-GB copies of global graphs.
 diff:{truncateThreshold:200,maxDepth:6},
 reporters:[new BoundedHNativeReporter()],
 include:['scripts/ediel-at-z05h-z08h-supplier-native.test.ts']}})
