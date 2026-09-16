import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

const resource = /[\\/]next[\\/]dist[\\/]client[\\/]components[\\/]segment-cache[\\/]/
describe('production navigation cache chunk boundary', () => {
  function baseConfig() {
    return { optimization: { minimize: true, splitChunks: { chunks: 'all', cacheGroups: {
      framework: { name: 'framework', priority: 40 }, lib: { name: 'lib', priority: 30 },
    } } }, plugins: [], output: { publicPath: '/_next/' } }
  }
  it('retains default framework groups and only extracts the measured Next navigation cache', () => {
    const config = baseConfig()
    const original = config.optimization.splitChunks.cacheGroups
    const result = nextConfig.webpack!(config, { isServer: false, dev: false } as never)
    expect(result).toBe(config)
    expect(result.optimization.minimize).toBe(true)
    expect(result.optimization.splitChunks.cacheGroups.framework).toBe(original.framework)
    expect(result.optimization.splitChunks.cacheGroups.lib).toBe(original.lib)
    expect(result.optimization.splitChunks.cacheGroups.gridexNavigationCache).toMatchObject({
      name: 'gridex-navigation-cache', chunks: 'all', priority: 50, enforce: true, reuseExistingChunk: true,
    })
    expect(result.optimization.splitChunks.cacheGroups.gridexNavigationCache.test.source).toBe(resource.source)
    expect(Object.keys(result.optimization.splitChunks.cacheGroups).sort()).toEqual(['framework','gridexNavigationCache','lib'])
  })
  it.each([{isServer:true,dev:false},{isServer:false,dev:true},{isServer:true,dev:true}])('never changes server/development compilation %j', options => {
    const config=baseConfig(), snapshot=structuredClone(config)
    expect(nextConfig.webpack!(config,options as never)).toBe(config)
    expect(config).toEqual(snapshot)
  })
  it('does not enable splitting when the upstream configuration explicitly disables it',()=>{
    const config={optimization:{splitChunks:false}}
    expect(nextConfig.webpack!(config,{isServer:false,dev:false} as never)).toEqual(config)
    expect(config.optimization.splitChunks).toBe(false)
  })
  it('keeps unrelated application, authorization, React, and server modules out of the cache group',()=>{
    const config=nextConfig.webpack!(baseConfig(),{isServer:false,dev:false} as never)
    const match=config.optimization.splitChunks.cacheGroups.gridexNavigationCache.test as RegExp
    for(const item of ['/node_modules/next/dist/client/components/segment-cache/cache.js','C:\\node_modules\\next\\dist\\client\\components\\segment-cache\\scheduler.js']) expect(match.test(item)).toBe(true)
    for(const item of ['/lib/auth/permissions.ts','/node_modules/react-dom/client.js','/node_modules/next/dist/server/app.js','/node_modules/next/dist/client/components/app-router.js']) expect(match.test(item)).toBe(false)
  })
})
