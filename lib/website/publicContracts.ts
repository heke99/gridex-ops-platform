// Stable public facade. Implementations are split into characterized modules.
export type { PublicLegalTextVersion, PublicContractOffer, LegacyLegalAcceptanceType } from './publicContracts.part-1'
export { legalAcceptanceTypeForModule, selectLegalVersionForAcceptance, buildPublicLegalBlock, publicOfferReference } from './publicContracts.part-1'
export type { WebsiteLegalBundle, PublicPriceOptionDiagnostic } from './publicContracts.part-2'
export { publicContractResponse, WebsiteLegalBundleError, buildWebsiteLegalBundle } from './publicContracts.part-2'
export type { PublicContractFeedConsistencyIssue, PublicContractOfferDiagnostic } from './publicContracts.part-3'
export { PublicContractFeedConsistencyError, listPublicContractOffers, diagnosePublicContractOffers } from './publicContracts.part-3'
export { resolvePublicContractOffer } from './publicContractResolver'
