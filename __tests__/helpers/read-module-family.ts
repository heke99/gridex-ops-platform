import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export function readModuleFamily(relativePath: string): string {
  const absolutePath = path.join(process.cwd(), relativePath)
  const directory = path.dirname(absolutePath)
  const extension = path.extname(absolutePath)
  const basename = path.basename(absolutePath, extension)
  const partPattern = new RegExp(`^${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.part-\\d+${extension.replace('.', '\\.')}$$`)
  const modulePaths = [absolutePath]

  if (existsSync(directory)) {
    modulePaths.push(
      ...readdirSync(directory)
        .filter((entry) => partPattern.test(entry))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        .map((entry) => path.join(directory, entry)),
    )
  }

  return modulePaths.map((modulePath) => readFileSync(modulePath, 'utf8')).join('\n')
}
