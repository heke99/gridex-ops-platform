export type CanonicalEdielErrorKey =
  | 'OK'
  | 'OBJECT_NOT_IDENTIFIED'
  | 'ACTOR_NOT_CONNECTED'
  | 'INCORRECT_PERMISSION_STATUS'
  | 'INCORRECT_PERMISSION_END_REASON'
  | 'UTILTS_E31_INCORRECT_DATA'
  | 'MANDATORY_FIELD_MISSING'
  | 'INCORRECT_METERING_POINT_ID'
  | 'INCORRECT_GRID_AREA_ID'

export type CanonicalEdielError = {
  key: CanonicalEdielErrorKey
  ercCode: string
  fieldCode: string | null
  text: string
  family: 'APERAK' | 'UTILTS_ERR'
  source: string
}

export const CANONICAL_EDIEL_ERRORS: CanonicalEdielError[] = [
  { key: 'OK', ercCode: '100', fieldCode: null, text: 'OK', family: 'APERAK', source: 'Ediel APERAK positiv kvittens' },
  { key: 'OBJECT_NOT_IDENTIFIED', ercCode: '40', fieldCode: '105', text: 'The object could not be identified', family: 'APERAK', source: 'PRODAT/APERAK 16.B' },
  { key: 'ACTOR_NOT_CONNECTED', ercCode: '40', fieldCode: '107', text: 'The actor is not connected to the object', family: 'APERAK', source: 'PRODAT/APERAK 16.B' },
  { key: 'INCORRECT_PERMISSION_STATUS', ercCode: '41', fieldCode: '322', text: 'INCORRECT DATA - permission status', family: 'APERAK', source: 'PRODAT permission lifecycle' },
  { key: 'INCORRECT_PERMISSION_END_REASON', ercCode: '41', fieldCode: '324', text: 'INCORRECT DATA - permission end reason', family: 'APERAK', source: 'PRODAT permission lifecycle' },
  { key: 'UTILTS_E31_INCORRECT_DATA', ercCode: '41', fieldCode: '511a', text: 'INCORRECT DATA', family: 'APERAK', source: 'UTILTS E31 application validation' },
  { key: 'MANDATORY_FIELD_MISSING', ercCode: '41', fieldCode: '512', text: 'MANDATORY FIELD MISSING', family: 'APERAK', source: 'UTILTS/PRODAT application validation' },
  { key: 'INCORRECT_METERING_POINT_ID', ercCode: '42', fieldCode: '209', text: 'INCORRECT DATA - metering point id', family: 'APERAK', source: 'PRODAT object validation' },
  { key: 'INCORRECT_GRID_AREA_ID', ercCode: '42', fieldCode: '260', text: 'INCORRECT DATA - grid area id', family: 'APERAK', source: 'PRODAT object validation' },
]

export function getCanonicalEdielError(key: CanonicalEdielErrorKey): CanonicalEdielError {
  return CANONICAL_EDIEL_ERRORS.find((error) => error.key === key) ?? CANONICAL_EDIEL_ERRORS[0]!
}

export function canonicalShortFtxText(text: string | null | undefined, maxLength = 70): string {
  return String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/['+]/g, ' ')
    .trim()
    .slice(0, maxLength)
}
