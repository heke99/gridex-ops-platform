#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const budgetPath = path.join(root, 'quality/large-source-file-budget.json')
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'))
const sourceRoots = ['app', 'lib', 'scripts']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function sourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolutePath)
    return sourceExtensions.has(path.extname(entry.name)) ? [absolutePath] : []
  })
}

function lineCount(file) {
  const text = fs.readFileSync(file, 'utf8')
  if (text.length === 0) return 0
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0)
}

const configuredLegacyFiles = new Set(
  Object.keys(budget.grandfatheredMaximumLines),
)
const violations = []
const legacyFiles = []

for (const sourceRoot of sourceRoots) {
  for (const file of sourceFiles(path.join(root, sourceRoot))) {
    const relativePath = path.relative(root, file).split(path.sep).join('/')
    const lines = lineCount(file)
    const maximum =
      budget.grandfatheredMaximumLines[relativePath] ??
      budget.defaultMaximumLines

    if (lines > maximum) {
      violations.push(`${relativePath}: ${lines} lines exceeds budget ${maximum}`)
    }
    if (lines > budget.defaultMaximumLines) {
      legacyFiles.push({ relativePath, lines, maximum })
    }
    configuredLegacyFiles.delete(relativePath)
  }
}

for (const missing of configuredLegacyFiles) {
  violations.push(`Configured legacy file does not exist: ${missing}`)
}

if (violations.length > 0) {
  console.error('Large source file budget failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

legacyFiles.sort((a, b) => b.lines - a.lines)
console.log(
  `Large source file budget passed: ${legacyFiles.length} grandfathered files cannot grow and new source files are capped at ${budget.defaultMaximumLines} lines.`,
)
