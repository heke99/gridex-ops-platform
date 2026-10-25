// The one SVK grid-area feature the simulated ArcGIS service (svkArcgis.ts) serves. Its owner (Agare) is the ALS grid
// owner exactly as Ediel's actor registry names it: the platform binds an SVK owner to the registry owner by
// gridex_grid_owner_name_key, and any other name creates an unmapped platform owner and rebinds ALS to it (FINDINGS K-W1).
import { ALS_GRID_AREA, ALS_GRID_OWNER_NAME } from '../../helpers/reality/alsRegistry'

export const ALS_FEATURE = {
  type: 'Feature',
  id: 1,
  properties: { OBJECTID: 1, Natomrade: ALS_GRID_AREA, Namn: 'Alingsås', Agare: ALS_GRID_OWNER_NAME, Elomrade: 'SE3' },
  geometry: { type: 'Polygon', coordinates: [[[12.40, 57.85], [12.70, 57.85], [12.70, 58.00], [12.40, 58.00], [12.40, 57.85]]] },
}
