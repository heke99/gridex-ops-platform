const fs = require('node:fs')
const path = require('node:path')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sourceModuleFiles(file, root = process.cwd()) {
  const absolute = path.join(root, file)
  const directory = path.dirname(absolute)
  const extension = path.extname(absolute)
  const baseName = path.basename(absolute, extension)

  if (!fs.existsSync(absolute)) {
    throw new Error(`Source module does not exist: ${file}`)
  }

  const partPattern = new RegExp(`^${escapeRegExp(baseName)}\\.part-(\\d+)${escapeRegExp(extension)}$`)
  const parts = fs.readdirSync(directory)
    .map((name) => {
      const match = name.match(partPattern)
      return match ? { name, order: Number(match[1]) } : null
    })
    .filter(Boolean)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map((entry) => path.join(directory, entry.name))

  return [absolute, ...parts]
}

function readSourceModule(file, root = process.cwd()) {
  return sourceModuleFiles(file, root)
    .map((absolute) => fs.readFileSync(absolute, 'utf8'))
    .join('\n')
}

module.exports = {
  readSourceModule,
  sourceModuleFiles,
}
