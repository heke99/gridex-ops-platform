#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(process.cwd(), 'app')
const controlFlowCalls = new Set(['redirect', 'permanentRedirect', 'notFound'])
const violations = []

function inspectFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function findControlFlowCall(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      controlFlowCalls.has(node.expression.text)
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      violations.push(
        `${path.relative(process.cwd(), filePath)}:${position.line + 1} ${node.expression.text}() ligger i try med catch`,
      )
    }
    ts.forEachChild(node, findControlFlowCall)
  }

  function visit(node) {
    if (ts.isTryStatement(node) && node.catchClause) {
      findControlFlowCall(node.tryBlock)
      if (node.finallyBlock) findControlFlowCall(node.finallyBlock)
      visit(node.catchClause)
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(fullPath)
    else if (/\.(ts|tsx)$/.test(entry.name)) inspectFile(fullPath)
  }
}

walk(root)

if (violations.length > 0) {
  console.error('Next.js control-flow regression failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Next.js control-flow regression passed: no redirect/notFound/permanentRedirect inside try/catch.')
