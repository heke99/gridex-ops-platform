#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`✗ ${msg}`); process.exitCode = 1 } else console.log(`✓ ${msg}`) }

const z01 = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const builder = read('lib/ediel/prodat/builders/z01.ts')
const renderer = read('lib/ediel/prodat/engine.ts')
const genericBuilder = read('lib/ediel/prodat/builders/generic.ts')

assert(z01.includes("messageCode: 'Z01'") && z01.includes("messageFamily: 'PRODAT'"), 'Z01 outbound path is explicitly PRODAT/Z01')
assert(genericBuilder.includes('BGM+') || renderer.includes('BGM'), 'PRODAT renderer contains BGM segment support')
assert(z01.includes('buildEdifactEnvelope') && z01.includes('testFlag: params.routeContext.environment === \'production\' ? 0 : 1'), 'Z01 envelope sets production test flag correctly')
assert(z01.includes('senderSubAddress') && z01.includes('receiverSubAddress') && z01.includes('applicationReference'), 'Z01 envelope uses route-controlled sender/receiver subaddress/application reference')
assert(z01.includes('renderProdat26A') && z01.includes("code: 'Z01'"), 'Z01 uses canonical PRODAT 26A renderer')
assert(builder.includes('Z01') || renderer.includes('Z01'), 'Z01 builder/renderer fixture path exists')
if (process.exitCode) process.exit(process.exitCode)
