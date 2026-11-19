const { createHash } = require('node:crypto')
const { constants } = require('node:fs')
const { open } = require('node:fs/promises')
const { isAbsolute, join, resolve } = require('node:path')

// Match the local Storage file-size limit in supabase/config.toml.
const MAX_OBJECT_BYTES = 50 * 1024 * 1024
const MAX_RECEIPT_BYTES = 1024 * 1024
const RECEIPTS = new Set(['snapshot.json', 'database.json', 'storage.json'])
const OPAQUE_ID = /^[a-zA-Z0-9_-]{1,128}$/
const EXPORT_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const SHA256 = /^[0-9a-f]{64}$/

class EvidenceError extends Error {}

function fail(reason) {
  throw new EvidenceError(reason)
}

function isText(value, pattern) {
  return typeof value === 'string' && pattern.test(value)
}

function pathBelow(directory, name) {
  return join('/proc/self/fd', String(directory.fd), name)
}

async function openEvidenceRoot(directory, openDirectory = open) {
  if (process.platform !== 'linux' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/') {
    fail('invalid_root')
  }
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  let current = await openDirectory('/', flags).catch(() => fail('invalid_root'))
  try {
    for (const component of directory.slice(1).split('/')) {
      const parent = current
      // Each lookup has only one user-supplied component below an already open directory.
      current = await openDirectory(pathBelow(parent, component), flags)
      await parent.close()
    }
    return current
  } catch {
    await current.close()
    fail('invalid_root')
  }
}

async function readLocalFile(root, name, maxBytes, consume) {
  const handle = await open(
    pathBelow(root, name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch(() => fail('local_file_unavailable'))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1) fail('local_file_unavailable')
    if (before.size > maxBytes) fail('local_file_too_large')
    // The end offset is inclusive, so growth can be detected without reading an unbounded stream.
    const chunks = handle.createReadStream({ autoClose: false, start: 0, end: maxBytes })
    const result = await consume(chunks, before.size)
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      fail('local_file_changed')
    }
    return result
  } finally {
    await handle.close()
  }
}

async function readReceipt(root, name, snapshotId) {
  const body = await readLocalFile(root, name, MAX_RECEIPT_BYTES, async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const data = Buffer.concat(chunks)
    if (data.length > MAX_RECEIPT_BYTES) fail('local_file_too_large')
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    } catch {
      fail('invalid_receipt')
    }
  })
  if (!body || !isText(body.snapshotId, OPAQUE_ID) || !Array.isArray(body.objects) || body.objects.length === 0) {
    fail('invalid_receipt')
  }
  if (body.snapshotId !== snapshotId) fail('snapshot_mismatch')
  const objects = new Map()
  for (const item of body.objects) {
    if (!item || !isText(item.objectId, OPAQUE_ID)) fail('invalid_receipt')
    if (objects.has(item.objectId)) fail('duplicate_object')
    objects.set(item.objectId, item)
  }
  return objects
}

async function checkObject(root, reference, restored, downloaded, seenFiles) {
  const { sha256, byteLength, contentType } = reference
  if (!isText(sha256, SHA256) || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_OBJECT_BYTES
    || !isText(contentType, /^[\x20-\x7e]{1,255}$/) || contentType.trim() !== contentType) {
    fail('invalid_receipt')
  }
  if (restored.sha256 !== sha256) fail('database_hash_mismatch')
  if (downloaded.status !== 200 || downloaded.byteLength !== byteLength || downloaded.contentType !== contentType) {
    fail('storage_observation_mismatch')
  }
  const { fileName } = downloaded
  if (!isText(fileName, EXPORT_FILENAME) || RECEIPTS.has(fileName)) fail('invalid_receipt')
  if (seenFiles.has(fileName)) fail('duplicate_file')
  seenFiles.add(fileName)

  await readLocalFile(root, fileName, MAX_OBJECT_BYTES, async (chunks, fileSize) => {
    const hash = createHash('sha256')
    let observedBytes = 0
    for await (const chunk of chunks) {
      observedBytes += chunk.length
      if (observedBytes > byteLength) fail('object_mismatch')
      hash.update(chunk)
    }
    if (fileSize !== byteLength || observedBytes !== byteLength || hash.digest('hex') !== sha256) {
      fail('object_mismatch')
    }
  })
}

async function verify(directory, snapshotId) {
  const root = await openEvidenceRoot(directory)
  try {
    const expected = await readReceipt(root, 'snapshot.json', snapshotId)
    const database = await readReceipt(root, 'database.json', snapshotId)
    const storage = await readReceipt(root, 'storage.json', snapshotId)
    if (database.size !== expected.size || storage.size !== expected.size) fail('cohort_mismatch')
    for (const objectId of expected.keys()) {
      if (!database.has(objectId) || !storage.has(objectId)) fail('cohort_mismatch')
    }
    const seenFiles = new Set()
    for (const [objectId, reference] of expected) {
      await checkObject(root, reference, database.get(objectId), storage.get(objectId), seenFiles)
    }
    return expected.size
  } finally {
    await root.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || !isText(args[1], OPAQUE_ID)) fail('invalid_arguments')
  const objects = await verify(...args)
  console.log(JSON.stringify({ status: 'verified', objects }))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: 'unverified',
      reason: error instanceof EvidenceError ? error.message : 'local_read_failed',
    }))
    process.exitCode = 1
  })
}

module.exports = { openEvidenceRoot }
