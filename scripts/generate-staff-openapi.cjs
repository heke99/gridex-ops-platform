#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { artifacts } = require('./lib/staff-openapi-artifacts.cjs')

const root = process.cwd()
const check = process.argv.includes('--check')
const prepared = artifacts(root)
for (const [file, content] of Object.entries(prepared.files)) {
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) throw new Error(`Generated staff artifact is stale: ${file}`)
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
}
console.log(`Staff ${prepared.meta.version}: ${Object.keys(prepared.document.paths).length} documented paths, ${prepared.manifest.capabilities.length} protocol capabilities; ${check ? 'generation verified' : 'current artifacts generated'}.`)
