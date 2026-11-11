import { expect, it } from 'vitest'
import { assertOpsContainer, catalogueSql, assertPrivatePath } from '../scripts/demo/elklart-ops-bootstrap.mjs'
it('refuses foreign database resources and publicly exposed bindings', () => {
  const valid = { Name:'/supabase_db_elklart-ops-demo',Config:{Labels:{'com.supabase.cli.project':'elklart-ops-demo'}},HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'54322'}]}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'54322'}]}} }
  expect(() => assertOpsContainer(valid)).not.toThrow()
  expect(() => assertOpsContainer({...valid,Name:'/supabase_db_gridex-ops-platform'})).toThrow()
  expect(() => assertOpsContainer({...valid,HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'54322'}]}}})).toThrow()
  expect(() => assertOpsContainer({...valid,Config:{Labels:{'com.supabase.cli.project':'foreign'}}})).toThrow()
})
it('escapes catalogue literals and seeds only explicit role permissions', () => {
  const sql = catalogueSql([{key:'reader',label:"Reader's",description:'demo',audience:'internal',recommendedFor:'isolated test',loginAllowed:false}],{reader:{label:'Reader',description:'Isolated test',permissions:['customers.read']}})
  expect(sql).toContain("'Reader''s'")
  expect(sql).toContain("p.key='customers.read'")
  expect(sql).not.toContain("p.key='customers.write'")
})
it('refuses parent symlinks before runtime credentials are opened', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'elklart-path-'))
  const root = path.join(parent, 'runtime'); fs.mkdirSync(root, { mode: 0o700 })
  const outside = path.join(parent, 'outside'); fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(root, 'ops'))
  try {
    expect(() => assertPrivatePath(path.join(root, 'ops/accounts.json'), root)).toThrow(/Symlink/)
    expect(() => assertPrivatePath(path.join(outside, 'accounts.json'), root)).toThrow(/outside/)
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})
