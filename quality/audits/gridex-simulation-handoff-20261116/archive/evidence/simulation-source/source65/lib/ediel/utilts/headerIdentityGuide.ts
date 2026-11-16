/** Frozen U fields207/208/509, annex C UG-122-24. These physical header
 * predicates are shared by the original UTILTS and its ACK guide consumers;
 * neither establishes a verified actor relation or tenant by itself. */
export const UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS = Object.freeze({
 legalRoles:['MS','MR'] as readonly string[],
 ancillaryRoles:['DDK','DDQ','DDX','DEA','DEC','DER','DGG','DGI','EZ','MDR','PQ'] as readonly string[],
 legalAgencies:['260','9','305'] as readonly string[],
 gs1Agencies:['9','305'] as readonly string[],
 edielQualifier:'SVK',
 edielIdPattern:'^\\d{5}$',
 glnPattern:'^\\d{13}$',
 glnCheckWeights:[1,3] as readonly number[],
})

export function validUtiltsEdielIdentity(id:string):boolean {
 return new RegExp(UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS.edielIdPattern).test(id)
}
export function validUtiltsGs1Identity(id:string):boolean {
 const cfg=UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS
 return new RegExp(cfg.glnPattern).test(id)
  && [...id].reduce((sum,digit,index)=>sum+Number(digit)*cfg.glnCheckWeights[index%2],0)%10===0
}
export function validUtiltsLegalIdentity(party:{id:string;qualifier:string;agency:string}):boolean {
 const cfg=UTILTS_HEADER_IDENTITY_GUIDE_CONSTRAINTS
 return cfg.legalAgencies.includes(party.agency)
  && (party.agency!=='260'||party.qualifier===cfg.edielQualifier)
  && (party.qualifier!==cfg.edielQualifier||validUtiltsEdielIdentity(party.id))
  && (!cfg.gs1Agencies.includes(party.agency)||validUtiltsGs1Identity(party.id))
}
