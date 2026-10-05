import { test } from 'vitest'
import assert from 'node:assert/strict'
import { discoverAndRecordReceivedSources as discover, evidenceHash, type ReceivedSourceLedgerIO } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { COMPANY, OTHER, CUTOFF, row, snapshot } from '@/__tests__/helpers/receivedSourceInventoryFixtures'

const SNAPSHOT='44444444-4444-4444-8444-444444444444', ATTEMPT='55555555-5555-4555-8555-555555555555', HASH='a'.repeat(64)
const scope={companyId:COMPANY,environment:'test',cutoffAt:CUTOFF}
function ioFixture(value: unknown = {...snapshot(),snapshotId:SNAPSHOT,snapshotHash:HASH}, receiptChange: Record<string,unknown> = {}) {
  const opened: unknown[]=[]; const writes: Parameters<ReceivedSourceLedgerIO['appendDiscovery']>[0][]=[]
  const io: ReceivedSourceLedgerIO = {
    async openSnapshot(scope) { opened.push(scope); return value },
    async appendDiscovery(input) { writes.push(input); return {version:1,companyId:COMPANY,environment:'test',snapshotId:SNAPSHOT,snapshotHash:HASH,
      engineVersion:input.engineVersion,attemptId:ATTEMPT,inventoryHash:evidenceHash(input.inventoryText),...receiptChange} },
  }
  return {io,opened,writes}
}
test('real physical inventory is appended with exact snapshot and evidence hashes',async()=>{
  const {io,opened,writes}=ioFixture(); const result=await discover(scope,io)
  assert.equal(result.status,'enumerated'); assert.equal(result.persistence.status,'stored')
  assert.deepEqual(opened,[scope]); assert.equal(writes.length,1)
  assert.equal(writes[0].snapshotId,SNAPSHOT); assert.equal(writes[0].snapshotHash,HASH)
  const saved=JSON.parse(writes[0].inventoryText)
  assert.deepEqual(saved.sources[0].objects.map((object: {objectId:string})=>object.objectId),['MP-A','MP-B'])
  assert.equal(saved.sources[0].disposition,'not_checked'); assert.equal(saved.authorityStatus,'not_established')
  assert.equal(saved.selection,'not_performed'); assert.equal(saved.historyCoverage,'before_ledger_unknown')
  assert.ok(!writes[0].inventoryText.includes('rawPayload'))
})
for(const bad of [null,{}, {...scope,companyId:'tenant-a'},{...scope,companyId:` ${COMPANY}`},{...scope,environment:'staging'}, {...scope,cutoffAt:'2026-02-30T10:00:00Z'}]) test(`invalid caller scope causes no reads/writes: ${JSON.stringify(bad)}`,async()=>{
  const {io,opened,writes}=ioFixture(); const result=await discover(bad,io)
  assert.equal(result.status,'unavailable');assert.deepEqual(opened,[]);assert.deepEqual(writes,[])
})
for(const bad of [null,[],{}, {...snapshot(),companyId:OTHER}, {...snapshot(),environment:'production'}, {...snapshot([row(),row({sourceMessageId:OTHER,companyId:OTHER})])}]) test(`hostile snapshot cannot expose or persist source identifiers: ${JSON.stringify(bad).slice(0,75)}`,async()=>{
  const {io,writes}=ioFixture(bad);const result=await discover(scope,io)
  assert.equal(result.status,'read_failed');assert.deepEqual(result.sources,[]);assert.deepEqual(writes,[])
  assert.ok(!JSON.stringify(result).includes('MP-A'));assert.ok(!JSON.stringify(result).includes(SNAPSHOT))
})
for(const invalid of [{snapshotId:null},{snapshotId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'},{snapshotId:'unsafe'},{snapshotHash:null},{snapshotHash:'forged'}]) test(`missing or invalid snapshot evidence handle is not persisted: ${JSON.stringify(invalid)}`,async()=>{
  const {io,writes}=ioFixture({...snapshot(),snapshotId:SNAPSHOT,snapshotHash:HASH,...invalid});const result=await discover(scope,io)
  assert.equal(result.status,'read_failed');assert.deepEqual(writes,[]);assert.deepEqual(result.sources,[])
})
for(const receipt of [{version:2},{companyId:OTHER},{environment:'production'},{snapshotId:OTHER},{snapshotHash:'b'.repeat(64)},
 {attemptId:'bad'},{engineVersion:'untrusted'},{inventoryHash:'b'.repeat(64)}]) test(`receipt mismatch never claims confirmed persistence: ${JSON.stringify(receipt)}`,async()=>{
  const {io,writes}=ioFixture(undefined,receipt);const result=await discover(scope,io)
  assert.equal(writes.length,1);assert.equal(result.status,'incomplete');assert.equal(result.persistence.status,'unconfirmed')
  assert.equal(result.authorityStatus,'not_established');assert.ok(!JSON.stringify(result.persistence).includes(ATTEMPT))
})
test('unknown read-transaction outcome is redacted, never described as rolled back',async()=>{
  const {io,writes}=ioFixture();io.openSnapshot=async()=>{throw new Error('secret foreign account MP-SECRET')}
  const result=await discover(scope,io);assert.equal(result.status,'read_failed');assert.equal(result.persistence.status,'unconfirmed')
  assert.deepEqual(writes,[]);assert.ok(!JSON.stringify(result).includes('SECRET'))
})
test('unknown write-transaction outcome cannot change business selection or certify completeness',async()=>{
  const {io}=ioFixture();io.appendDiscovery=async()=>{throw new Error('sensitive database detail')}
  const result=await discover(scope,io);assert.equal(result.status,'incomplete');assert.equal(result.persistence.status,'unconfirmed')
  assert.equal(result.selection,'not_performed');assert.ok(!JSON.stringify(result).includes('sensitive'))
})
test('truncation is saved only as an incomplete empty observation',async()=>{
  const {io,writes}=ioFixture({...snapshot(),exhaustive:false,sourceCount:1001,sources:[],snapshotId:SNAPSHOT,snapshotHash:HASH})
  const result=await discover(scope,io);assert.equal(result.status,'incomplete');assert.deepEqual(result.sources,[])
  assert.equal(JSON.parse(writes[0].inventoryText).status,'incomplete')
})
test('an unknown receipt remains an incomplete persisted observation',async()=>{
  const {io}=ioFixture({...snapshot([row({receivedContext:null,sourceReceivedAt:null})]),snapshotId:SNAPSHOT,snapshotHash:HASH})
  const result=await discover(scope,io);assert.equal(result.status,'incomplete');assert.equal(result.persistence.status,'stored')
  assert.equal(result.sources[0].receiptStatus,'unavailable');assert.equal(result.sources[0].disposition,'not_checked')
})
test('an empty visible set has no pre-ledger historical authority',async()=>{
  const {io}=ioFixture({...snapshot([]),snapshotId:SNAPSHOT,snapshotHash:HASH});const result=await discover(scope,io)
  assert.equal(result.persistence.status,'stored');assert.equal(result.status,'enumerated');assert.equal(result.historyCoverage,'before_ledger_unknown')
})
test('snapshot before capture activation never becomes an evidence receipt',async()=>{
  const {io,writes}=ioFixture({...snapshot([],{openedAt:'2026-09-22T10:00:00.000001Z'}),snapshotId:SNAPSHOT,snapshotHash:HASH})
  const result=await discover(scope,io);assert.equal(result.status,'unavailable');assert.deepEqual(writes,[])
})
test('the original microsecond cutoff literal reaches the RPC unchanged',async()=>{
  const cutoff='2026-09-22T12:00:00.000001+02:00';const {io,opened}=ioFixture({...snapshot([],{cutoffAt:cutoff}),snapshotId:SNAPSHOT,snapshotHash:HASH})
  await discover({...scope,cutoffAt:cutoff},io);assert.deepEqual(opened,[{...scope,cutoffAt:cutoff}])
})
