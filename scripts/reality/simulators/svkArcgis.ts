// Svenska kraftnät's public grid-area service (ArcGIS FeatureServer), simulated for a world whose network policy
// denies services2.arcgis.com (FINDINGS T26). The platform only accepts that exact origin and path
// (lib/energy/svkGeometryImport.ts safeSvkServiceUrl), so up.sh maps the host to 127.0.0.1 in /etc/hosts and this
// server answers on 443 with a certificate from the world's own CA (trusted by the app through NODE_EXTRA_CA_CERTS).
//
//   GET /L8WLzcxhwLqd80Jx/ArcGIS/rest/services/Natomraden_250526/FeatureServer/3/query?...&f=geojson&resultOffset=N
//
// One feature: grid area ALS (Alingsås Energi Nät AB, SE3) as a box around every point the scenarios place in the world
// (57.93 N, 12.53 E). It is a simulation of the real polygon, not its shape: only membership of those points is real.
// Run by up.sh with REALITY_SVK_SOURCE=simulated; REALITY_TLS_DIR holds svk.key/svk.pem.
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tls = process.env.REALITY_TLS_DIR ?? '/tmp/gridex-reality/tls'
const port = Number(process.env.REALITY_SVK_PORT ?? 443)
const PATH = '/L8WLzcxhwLqd80Jx/ArcGIS/rest/services/Natomraden_250526/FeatureServer/3/query'

const ALS = {
  type: 'Feature',
  id: 1,
  properties: { OBJECTID: 1, Natomrade: 'ALS', Namn: 'Alingsås', Agare: 'Alingsås Energi Nät AB', Elomrade: 'SE3' },
  geometry: { type: 'Polygon', coordinates: [[[12.40, 57.85], [12.70, 57.85], [12.70, 58.00], [12.40, 58.00], [12.40, 57.85]]] },
}

const server = createServer({ key: readFileSync(join(tls, 'svk.key')), cert: readFileSync(join(tls, 'svk.pem')) }, (req, res) => {
  const url = new URL(req.url ?? '/', 'https://services2.arcgis.com')
  if (req.method !== 'GET' || url.pathname !== PATH) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 404, message: 'not found' } }))
    return
  }
  const offset = Number(url.searchParams.get('resultOffset') ?? 0)
  const features = offset === 0 ? [ALS] : []
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ type: 'FeatureCollection', features, exceededTransferLimit: false }))
})
server.listen(port, '127.0.0.1', () => console.log(`[svk-arcgis] listening on https://services2.arcgis.com:${port} (127.0.0.1)`))
