import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('the actual legacy native config resolves the dynamic support server marker while retaining the real missing-actor denial', () => {
  const root = resolve(__dirname, '..'), temporary = mkdtempSync(resolve(tmpdir(), 'ediel-native-marker-'))
  const status = resolve(temporary, 'status.json'), probe = resolve(temporary, 'marker.test.ts'), config = resolve(temporary, 'vitest.config.ts')
  try {
    // Synthetic configuration is sufficient to import modules. This probe
    // must stop at the real actor gate before any database/network operation.
    writeFileSync(status, JSON.stringify({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'isolated-module-marker-only', SERVICE_ROLE_KEY: 'isolated-module-marker-only' }), { mode: 0o600 })
    writeFileSync(probe, `import {it,expect} from ${JSON.stringify(resolve(root,'node_modules/vitest/dist/index.js'))};
      import {createTenantSupportCase} from ${JSON.stringify(resolve(root,'lib/customer-cases/support.ts'))};
      it('real dynamic support import reaches the unchanged actor gate',async()=>{
        await expect(createTenantSupportCase({companyId:'10000000-0000-4000-8000-000000000001',customerId:'20000000-0000-4000-8000-000000000001',
          title:'Isolated module import',channel:'admin',actorUserId:'30000000-0000-4000-8000-000000000001'})).rejects.toMatchObject({code:'support_actor_forbidden',status:403});
      });`, { mode: 0o600 })
    writeFileSync(config, `import actual from ${JSON.stringify(resolve(root,'scripts/ediel-source-owner-native.config.ts'))};
      export default {...actual,test:{...actual.test,include:[${JSON.stringify(probe)}],root:${JSON.stringify(root)}}};`, { mode: 0o600 })
    const child = spawnSync(process.execPath, [resolve(root,'node_modules/vitest/vitest.mjs'),'run','--config',config], {
      cwd: root, env: { ...process.env, GRIDEX_NATIVE_STATUS: status }, encoding: 'utf8', timeout: 30_000,
    })
    expect(child.error).toBeUndefined()
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0)
    expect(child.stdout).toContain('1 passed')
  } finally { rmSync(temporary,{recursive:true,force:true}) }
}, 35_000)
