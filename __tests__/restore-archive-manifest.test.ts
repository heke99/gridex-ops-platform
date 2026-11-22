import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'verify-restore-archive-manifest.cjs')
const ROOTS: string[] = []
const SNAPSHOT = 'backup-01'
const STORAGE_LIMIT = 50 * 1024 * 1024
const CONTENT_TYPE = 'message/rfc822'
const FIRST_FILE = 'object-01.bin'
const RECEIPT_NAMES = ['snapshot.json', 'database.json', 'storage.json'] as const

function fixture(parent = realpathSync(tmpdir())) {
  const root = mkdtempSync(join(parent, 'gridex-restore-evidence-'))
  ROOTS.push(root)
  const records = [
    { objectId: 'source-A', fileName: FIRST_FILE, bytes: Buffer.from('Original A\r\n\r\n') },
    { objectId: 'source-B', fileName: 'object-02.bin', bytes: Buffer.from('Original B\r\n\r\n') },
  ]
  const expected = records.map(({ objectId, bytes }) => ({
    objectId,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: CONTENT_TYPE,
  }))
  const database = expected.map(({ objectId, sha256 }) => ({ objectId, sha256 })).reverse()
  const storage = records.map(({ objectId, fileName, bytes }) => ({
    objectId, fileName, byteLength: bytes.length, contentType: CONTENT_TYPE, status: 200,
  }))
  for (const record of records) writeFileSync(join(root, record.fileName), record.bytes)
  return { root, expected, database, storage }
}

function verify(data: ReturnType<typeof fixture>, observedSnapshot = SNAPSHOT, readRoot = data.root) {
  const sets = [data.expected, data.database, data.storage]
  RECEIPT_NAMES.forEach((name, index) => {
    writeFileSync(join(data.root, name), JSON.stringify({
      snapshotId: index === 1 ? observedSnapshot : SNAPSHOT, objects: sets[index],
    }))
  })
  return spawnSync(process.execPath, [SCRIPT, readRoot, SNAPSHOT], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', NODE_DISABLE_COMPILE_CACHE: '1' },
    timeout: 5000,
  })
}

function expectUnverified(result: ReturnType<typeof verify>, reason: string) {
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe(`${JSON.stringify({ status: 'unverified', reason })}\n`)
}

afterEach(() => {
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('offline archive restore evidence', () => {
  it('compares independent sets and reports only the verified object count', () => {
    const result = verify(fixture())
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('{"status":"verified","objects":2}\n')
    expect(result.stderr).toBe('')
  })

  it('requires all three receipts to refer to the explicitly selected snapshot', () => {
    expectUnverified(verify(fixture(), 'backup-02'), 'snapshot_mismatch')
  })

  it.each(['expected', 'database', 'storage'] as const)('rejects repeated IDs in the %s receipt', (set) => {
    const data = fixture()
    if (set === 'expected') data.expected.push({ ...data.expected[0] })
    if (set === 'database') data.database.push({ ...data.database[0] })
    if (set === 'storage') data.storage.push({ ...data.storage[0] })
    expectUnverified(verify(data), 'duplicate_object')
  })

  it('requires every declared object in both restored observations', () => {
    const data = fixture()
    data.database.pop()
    expectUnverified(verify(data), 'cohort_mismatch')
    data.database = fixture().database
    data.storage.pop()
    expectUnverified(verify(data), 'cohort_mismatch')
  })

  it('rejects extra observations even when all required objects are present', () => {
    const data = fixture()
    data.database.push({ ...data.database[0], objectId: 'source-unexpected' })
    expectUnverified(verify(data), 'cohort_mismatch')
  })

  it('rejects evidence from an empty cohort', () => {
    const data = fixture()
    data.expected = []
    data.database = []
    data.storage = []
    expectUnverified(verify(data), 'invalid_receipt')
  })

  it('requires the independently restored database to report the original archive hash', () => {
    const data = fixture()
    data.database[0].sha256 = '0'.repeat(64)
    expectUnverified(verify(data), 'database_hash_mismatch')
  })

  it('rejects physical bytes that differ even when the file length is still correct', () => {
    const data = fixture()
    writeFileSync(join(data.root, FIRST_FILE), Buffer.alloc(data.expected[0].byteLength, 65))
    expectUnverified(verify(data), 'object_mismatch')
  })

  it.each([
    { status: 500 }, { contentType: 'application/octet-stream' }, { byteLength: 999 },
  ])('requires a successful read using the expected Storage metadata %j', (changed) => {
    const data = fixture()
    Object.assign(data.storage[0], changed)
    expectUnverified(verify(data), 'storage_observation_mismatch')
  })

  it('requires a distinct exported file per immutable source ID', () => {
    const data = fixture()
    data.storage[1].fileName = FIRST_FILE
    expectUnverified(verify(data), 'duplicate_file')
  })

  it('requires local evidence files to have an ordinary leaf filename', () => {
    const data = fixture()
    data.storage[0].fileName = 'objects/object-01.bin'
    expectUnverified(verify(data), 'invalid_receipt')
  })

  it('does not count a missing evidence file as a restored object', () => {
    const data = fixture()
    rmSync(join(data.root, FIRST_FILE))
    expectUnverified(verify(data), 'local_file_unavailable')
  })

  it('requires a regular file rather than a symbolic link to the local fixture', () => {
    const data = fixture()
    rmSync(join(data.root, FIRST_FILE))
    symlinkSync('object-02.bin', join(data.root, FIRST_FILE))
    expectUnverified(verify(data), 'local_file_unavailable')
  })

  it('requires the explicitly supplied evidence root itself to be canonical', () => {
    const data = fixture()
    const rootAlias = join(data.root, 'alias')
    symlinkSync(data.root, rootAlias, 'dir')
    expectUnverified(verify(data, SNAPSHOT, rootAlias), 'invalid_root')
  })

  it('requires all ancestor directories of the evidence root to be ordinary directories', () => {
    const wrapper = fixture()
    const realParent = join(wrapper.root, 'real-parent')
    const linkedParent = join(wrapper.root, 'linked-parent')
    mkdirSync(realParent)
    const data = fixture(realParent)
    symlinkSync('real-parent', linkedParent, 'dir')
    const relativeEvidence = data.root.slice(realParent.length + 1)
    expectUnverified(verify(data, SNAPSHOT, join(linkedParent, relativeEvidence)), 'invalid_root')
  })

  it('opens evidence below the already selected parent after an ordinary directory move', async () => {
    const data = fixture()
    const parent = join(data.root, 'selected-parent')
    const evidence = join(parent, 'evidence')
    mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'marker.txt'), 'original cohort fixture')
    const { openEvidenceRoot }: {
      openEvidenceRoot: (directory: string, openDirectory: typeof open) => Promise<FileHandle>
    } = createRequire(SCRIPT)(SCRIPT)

    let moved = false
    const root = await openEvidenceRoot(evidence, async (candidate, flags) => {
      expect(Number(flags) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
      expect(Number(flags) & constants.O_DIRECTORY).toBe(constants.O_DIRECTORY)
      const handle = await open(candidate, flags)
      if (String(candidate).endsWith('/selected-parent')) {
        renameSync(parent, join(data.root, 'moved-parent'))
        mkdirSync(evidence, { recursive: true })
        writeFileSync(join(evidence, 'marker.txt'), 'replacement directory fixture')
        moved = true
      }
      return handle
    })
    try {
      expect(moved).toBe(true)
      expect(readFileSync(join(evidence, 'marker.txt'), 'utf8')).toBe('replacement directory fixture')
      expect(readFileSync(`/proc/self/fd/${root.fd}/marker.txt`, 'utf8')).toBe('original cohort fixture')
    } finally {
      await root.close()
    }
  })

  it('rejects an oversized physical object before hashing it', () => {
    const data = fixture()
    truncateSync(join(data.root, FIRST_FILE), STORAGE_LIMIT + 1)
    expectUnverified(verify(data), 'local_file_too_large')
  })
})
