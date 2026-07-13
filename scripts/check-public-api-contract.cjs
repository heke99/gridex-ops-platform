const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const registry = fs.readFileSync(path.join(root, 'lib/api/publicRouteRegistry.ts'), 'utf8')
const routeFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name === 'route.ts') routeFiles.push(full)
  }
}
walk(path.join(root, 'app/api/v1'))

const missing = []
for (const file of routeFiles) {
  const rel = '/' + path.relative(path.join(root, 'app'), file).replaceAll(path.sep, '/').replace(/\/route\.ts$/, '')
  const source = fs.readFileSync(file, 'utf8')
  for (const method of ['GET', 'POST']) {
    if (new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source)) {
      if (!registry.includes(`path: '${rel}'`) || !registry.includes(`method: '${method}'`)) missing.push(`${method} ${rel}`)
    }
  }
}
if (missing.length) {
  console.error('Public API registry saknar routes:\n' + missing.map((v) => `- ${v}`).join('\n'))
  process.exit(1)
}
console.log(`Public API contract OK (${routeFiles.length} route files).`)
