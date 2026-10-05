#!/usr/bin/env node
// Exactly five static checker counterexamples. Production modules are read as
// text and mutated only in memory; no production/native effects are executed.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {createRequire} = require('node:module')
const {createHash} = require('node:crypto')
const root = path.resolve(process.argv[2])
const runnerPath = path.join(root, 'scripts/gridex-supplier-remaining-business-regression.cjs')
const runner = fs.readFileSync(runnerPath, 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
if (hash(runner) !== '1937ab14b3ff9fd84e4c1f2f762c477b135b87fb632ffd248d068f851798f7b3') throw Error('unexpected checker source')
const localRequire = createRequire(runnerPath)
const supplyPath = 'lib/ediel/flows/inboundBusinessStateMachineLegacy.ts'
const ackPath = 'lib/ediel/flows/inboundAckProcessing.ts'
const supply = fs.readFileSync(path.join(root, supplyPath), 'utf8')
const ack = fs.readFileSync(path.join(root, ackPath), 'utf8')
const sourceBinding = 'const sourceResult = sourceSupplyResult ?? await applySupplyMarketSource({ actorUserId: input.actorUserId,message: input.message })'
if (supply.split(sourceBinding).length !== 2) throw Error('unexpected accepted source result binding')
const cases = [{
  id:'discarded-native-supply-return', path:supplyPath, original:supply,
  mutated:supply.replace(sourceBinding, 'await applySupplyMarketSource({ actorUserId: input.actorUserId,message: input.message });\n    const sourceResult = {applied: true, commits: []}'),
  expected:'FAIL: characterized PRODAT side effects create or update supply periods',
}]
for (const [variable, name] of [
  ['outboundRequest','syncOutboundRequestFromInboundAck'],
  ['switchResult','syncSwitchFromInboundAck'],
  ['gridOwnerDataRequest','syncGridOwnerDataRequestFromInboundAck'],
  ['customerCase','syncCustomerCaseCancellationAck'],
]) {
  const start = ack.indexOf(`const ${variable} = allowBusinessTransition ? await ${name}({`)
  if (start < 0) throw Error(`missing actual ${variable} declaration`)
  const end = ack.indexOf('}) : null;',start)
  if (end < 0) throw Error(`missing actual ${variable} false arm`)
  const mutated = ack.slice(0,end) + `}) : await ${name}({actorUserId,sourceMessage,ackMessage,outcome});` + ack.slice(end+'}) : null;'.length)
  cases.push({id:`non-null-${variable}-false-arm`,path:ackPath,original:ack,mutated,expected:'FAIL: ack processing delegates qualified source outcomes before business transitions'})
}
class CheckerExit extends Error { constructor(code) { super('checker exit'); this.code=code } }
let failures=0
for (const item of cases) {
  const logs=[]
  let exit=0,unexpected=null
  const sourcePath=path.join(root,item.path)
  const reader={readFileSync(file,encoding) { return path.resolve(String(file))===sourcePath ? item.mutated : fs.readFileSync(file,encoding) }}
  try {
    vm.runInNewContext(runner,{
      require(name) { return name==='node:fs' ? reader : localRequire(name) },
      process:{cwd:()=>root,exit:code=>{throw new CheckerExit(code)}},
      console:{log:message=>logs.push(String(message)),error:message=>logs.push(String(message))},
    },{filename:runnerPath,timeout:10000})
  } catch(error) {
    if(error instanceof CheckerExit) exit=error.code
    else {unexpected=String(error);exit=-1}
  }
  const rejected=exit===1 && logs.at(-1)===item.expected && !unexpected
  if(!rejected) failures++
  console.log(JSON.stringify({id:item.id,path:item.path,original_sha256:hash(item.original),in_memory_mutant_sha256:hash(item.mutated),checker_exit:exit,expected_failure:item.expected,actual_failure:logs.at(-1),ok_before_stop:logs.filter(line=>line.startsWith('OK: ')).length,rejected,unexpected,scope:'STATIC_CHECKER_CONTROL_ONLY_NO_PRODUCT_OR_NATIVE_EXECUTION'}))
}
console.log(JSON.stringify({controls:cases.length,rejected:cases.length-failures,failures,runner_sha256:hash(runner),source_writes:0,product_native_runs:0}))
process.exit(failures ? 1 : 0)
