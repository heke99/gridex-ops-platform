#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const chunksRoot = path.join(root, '.next/static/chunks')
const budget = require('../quality/performance-budgets.json').browserBundle

if (!fs.existsSync(chunksRoot)) {
  console.error('Bundle budget requires a completed Next.js production build in .next/.')
  process.exit(1)
}

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFiles(absolutePath)
    return entry.name.endsWith('.js') ? [absolutePath] : []
  })
}

const files = javascriptFiles(chunksRoot)
const violations = []
const largest = files
  .map((file) => ({ file, bytes: fs.statSync(file).size }))
  .sort((left, right) => right.bytes - left.bytes)[0]

if (largest && largest.bytes > budget.maximumIndividualChunkBytes) {
  violations.push(
    `${path.relative(chunksRoot, largest.file)} is ${largest.bytes} bytes; maximum is ${budget.maximumIndividualChunkBytes}`,
  )
}

for (const [route, maximumBytes] of Object.entries(budget.routeBudgets)) {
  const routeDirectory = path.join(chunksRoot, route)
  const routeBytes = fs.existsSync(routeDirectory)
    ? javascriptFiles(routeDirectory).reduce((sum, file) => sum + fs.statSync(file).size, 0)
    : 0
  if (routeBytes > maximumBytes) {
    violations.push(`${route} is ${routeBytes} bytes; maximum is ${maximumBytes}`)
  }
}

if (violations.length > 0) {
  console.error(`Browser bundle budget failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`)
  process.exit(1)
}

console.log(
  `Browser bundle budget passed: largest chunk ${largest?.bytes ?? 0} bytes; ${Object.keys(budget.routeBudgets).length} route budgets verified.`,
)
