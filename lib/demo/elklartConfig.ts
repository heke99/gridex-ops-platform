const demoHost = 'demo.gridex.se'
const portalHost = 'mina-sidor-demo.gridex.se'

export function resolveElklartDemoConfig(
  environment: { ELKLART_DEMO_ENABLED?: string; ELKLART_DEMO_COMPANY_ID?: string; ELKLART_DEMO_PORTAL_ORIGIN?: string; NODE_ENV?: string },
  host: string | null,
) {
  const companyId = environment.ELKLART_DEMO_COMPANY_ID
  if (environment.ELKLART_DEMO_ENABLED !== 'true' || !companyId) return null
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(companyId)) return null

  if (environment.NODE_ENV === 'development' && host === 'localhost:3000') {
    const portalOrigin = environment.ELKLART_DEMO_PORTAL_ORIGIN ?? 'http://localhost:3001'
    if (!['http://localhost:3001', 'https://localhost:3001'].includes(portalOrigin)) return null
    return { companyId, portalOrigin }
  }
  if (host !== demoHost) return null
  return { companyId, portalOrigin: `https://${portalHost}` }
}
