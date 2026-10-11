/** Pure protected-source shape only. This union/predicate issues no preparation,
 * validation, rendering, original-read or transport authority. */
type CustomerMasterdataFields={nameParts:string[];postalCode:string;city:string;country:string}
export type PresentCustomerMasterdataShape=CustomerMasterdataFields&{streetParts:string[];streetAvailability?:never}
export type KnownUnavailableCustomerMasterdataShape=CustomerMasterdataFields&{streetParts:[''];streetAvailability:'known_unavailable'}
export type CustomerMasterdataShape=PresentCustomerMasterdataShape|KnownUnavailableCustomerMasterdataShape
export type ReadonlyCustomerMasterdataShape=Readonly<{nameParts:readonly string[];postalCode:string;city:string;country:string}>&(
 Readonly<{streetParts:readonly string[];streetAvailability?:never}>|
 Readonly<{streetParts:readonly [''];streetAvailability:'known_unavailable'}>)

/** Presence, including an inherited/invalid discriminator, selects the strict
 * branch. An unknown tag must never fall through the legacy present predicate. */
export function hasCustomerMasterdataStreetAvailability(value:unknown):boolean {
 return !!value&&typeof value==='object'&&'streetAvailability' in value
}

/** Exact signed six-key variant. Never trim, infer absence or borrow another
 * party's address. Callers retain their existing untagged legacy checks. */
export function isKnownUnavailableCustomerMasterdataShape(value:unknown):value is KnownUnavailableCustomerMasterdataShape {
 if(!value||typeof value!=='object'||Array.isArray(value))return false
 const d=value as Record<string,unknown>,keys=Reflect.ownKeys(d)
 const expected=['nameParts','streetParts','postalCode','city','country','streetAvailability']
 if(keys.length!==expected.length||keys.some(key=>typeof key!=='string'||!expected.includes(key)))return false
 const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>=1&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)
 return d.streetAvailability==='known_unavailable'&&Array.isArray(d.streetParts)&&d.streetParts.length===1&&d.streetParts[0]===''
  &&Array.isArray(d.nameParts)&&d.nameParts.length>=1&&d.nameParts.length<=2&&d.nameParts.every(part=>text(part,35))
  &&text(d.postalCode,9)&&text(d.city,35)&&typeof d.country==='string'&&/^[A-Z]{2}$/.test(d.country)
}
