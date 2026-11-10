const demoHost = 'demo.gridex.se'
const portalHost = 'mina-sidor-demo.gridex.se'

export function resolveElklartDemoConfig(
  environment: NodeJS.ProcessEnv,
  host: string | null,
) {
  const companyId = environment.ELKLART_DEMO_COMPANY_ID
  if (environment.ELKLART_DEMO_ENABLED !== 'true' || !companyId) return null
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(companyId)) return null

  if (environment.NODE_ENV === 'development' && host === 'localhost:3000') {
    return { companyId, portalOrigin: 'http://localhost:3001' }
  }
  if (host !== demoHost) return null
  return { companyId, portalOrigin: `https://${portalHost}` }
}
