import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ownsCommand, parseIdentity, privateOwned, validateCapwaySecrets } from '../scripts/demo/elklart-boundary-apps.mjs'
describe('owned demo boundary launchers', () => {
  it('accepts only exact supervisor script, executable, action and boundary', () => {
    const script = path.resolve('scripts/demo/elklart-boundary-apps.mjs')
    expect(ownsCommand(`/node\0${script}\0serve\0resend\0`, '/node', 'resend')).toBe(true)
    for (const args of [['/foreign','serve','resend'], [script,'start','resend'], [script,'serve','capway'], [script,'serve','resend','extra']]) expect(ownsCommand(['/node',...args].join('\0'), '/node','resend')).toBe(false)
  })
  it('parses zombie/start/group identity even when process name contains parentheses', () => {
    const fields = ['Z', '1', '123', '123', ...Array(15).fill('0'), '987654']
    expect(parseIdentity(`123 (name ) and spaces) ${fields.join(' ')}`)).toEqual({state:'Z',group:123,session:123,started:'987654'})
  })
  it('forwards only private Capway credentials with explicit lower-case test mode', () => {
    const env = validateCapwaySecrets({ ELKLART_CAPWAY_API_KEY:'a'.repeat(32),ELKLART_CAPWAY_WEBHOOK_SECRET:'b'.repeat(32), CRON_SECRET:'never-forward',NODE_OPTIONS:'--import=bad' })
    expect(Object.keys(env).sort()).toEqual(['ELKLART_CAPWAY_API_KEY','ELKLART_CAPWAY_ENVIRONMENT','ELKLART_CAPWAY_WEBHOOK_SECRET'].sort())
    expect(env.ELKLART_CAPWAY_ENVIRONMENT).toBe('test')
    expect(()=>validateCapwaySecrets({ELKLART_CAPWAY_API_KEY:'short'})).toThrow()
  })
  it('refuses public modes and symlinks for private credentials', () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boundary-private-')); const file=path.join(dir,'credential')
    try {fs.writeFileSync(file,'fictional',{mode:0o600});privateOwned(file);fs.chmodSync(file,0o644);expect(()=>privateOwned(file)).toThrow();fs.chmodSync(file,0o600);fs.symlinkSync(file,path.join(dir,'link'));expect(()=>privateOwned(path.join(dir,'link'))).toThrow()}finally{fs.rmSync(dir,{recursive:true})}
  })
})
