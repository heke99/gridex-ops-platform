'use strict'

const fs = require('node:fs')
const path = require('node:path')

function readSourceFamily(root, relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) return ''

  const directory = path.dirname(absolutePath)
  const extension = path.extname(absolutePath)
  const basename = path.basename(absolutePath, extension)
  const escapedBasename = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedExtension = extension.replace('.', '\\.')
  const partPattern = new RegExp(`^${escapedBasename}\\.part-\\d+${escapedExtension}$`)
  const partPaths = fs
    .readdirSync(directory)
    .filter((entry) => partPattern.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((entry) => path.join(directory, entry))

  return [absolutePath, ...partPaths]
    .map((sourcePath) => fs.readFileSync(sourcePath, 'utf8'))
    .join('\n')
}

module.exports = { readSourceFamily }
