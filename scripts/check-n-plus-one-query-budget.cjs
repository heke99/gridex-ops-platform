#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const sourceRoots = [
  'app/api/v1',
  'lib/customer-portal',
  'lib/pricing',
  'lib/website',
]
const violations = []

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolutePath)
    return /\.tsx?$/.test(entry.name) ? [absolutePath] : []
  })
}

function isLoop(node) {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  )
}

function containsAwaitedDatabaseRead(node) {
  let found = false
  function visit(candidate) {
    if (found) return
    if (ts.isAwaitExpression(candidate)) {
      const awaited = candidate.expression.getText()
      const isMutationReturningRows = /\.(?:insert|update|upsert|delete)\s*\([\s\S]*\.select\s*\(/.test(awaited)
      if (/\.select\s*\(/.test(awaited) && !isMutationReturningRows) found = true
    }
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return found
}

for (const sourceRoot of sourceRoots) {
  for (const file of sourceFiles(path.join(root, sourceRoot))) {
    const source = fs.readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    function visit(node) {
      const loopSource = node.getFullText(sourceFile)
      const hasBoundedQueryMarker = /query-loop-budget:\s*(?:bounded-[a-z-]+\s+max=\d+|paginated-scan\s+page=\d+)/.test(loopSource)
      if (isLoop(node) && !hasBoundedQueryMarker && containsAwaitedDatabaseRead(node)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        violations.push(`${path.relative(root, file)}:${line} awaits a database call inside a loop`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
}

if (violations.length > 0) {
  console.error(`N+1 query budget failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`)
  process.exit(1)
}

console.log(`N+1 query budget passed: 0 awaited database calls inside loops across ${sourceRoots.join(', ')}.`)
