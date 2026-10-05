'use strict'

const fs = require('node:fs')
const path = require('node:path')

const originalReadFileSync = fs.readFileSync.bind(fs)
const root = process.cwd()
const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : ''
const scriptsRoot = path.join(root, 'scripts') + path.sep
const active = entrypoint.startsWith(scriptsRoot) && path.basename(entrypoint).startsWith('gridex-') && entrypoint.endsWith('.cjs')

function isUtf8Read(options) {
  return options === 'utf8' || options === 'utf-8' || options?.encoding === 'utf8' || options?.encoding === 'utf-8'
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bundledSource(filePath, source) {
  const extension = path.extname(filePath)
  if (!['.ts', '.tsx'].includes(extension)) return source
  if (!filePath.startsWith(root + path.sep)) return source

  const directory = path.dirname(filePath)
  const baseName = path.basename(filePath, extension)
  const pattern = new RegExp(`^${escapeRegExp(baseName)}\\.part-(\\d+)${escapeRegExp(extension)}$`)
  const parts = fs.readdirSync(directory)
    .map((name) => {
      const match = name.match(pattern)
      return match ? { name, order: Number(match[1]) } : null
    })
    .filter(Boolean)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))

  if (parts.length === 0) return source

  const partSources = parts.map((part) => originalReadFileSync(path.join(directory, part.name), 'utf8'))
  return [source, ...partSources].join('\n')
}

if (active) {
  fs.readFileSync = function refactorSafeReadFileSync(file, options) {
    const result = originalReadFileSync(file, options)
    if (!isUtf8Read(options) || typeof result !== 'string') return result

    const resolved = typeof file === 'string' || Buffer.isBuffer(file)
      ? path.resolve(String(file))
      : file instanceof URL && file.protocol === 'file:'
        ? path.resolve(file.pathname)
        : null
    if (!resolved) return result

    return bundledSource(resolved, result)
  }
}
