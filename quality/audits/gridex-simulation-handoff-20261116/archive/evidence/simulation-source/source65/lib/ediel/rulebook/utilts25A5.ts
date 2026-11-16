/** Current Swedish original, independently acquired as Ediel Document/3364.
 * Its cover, not the shared E5SE5A wire identifier, establishes revision5.
 * Historical editions and their protected original witnesses retain their own
 * identities. This descriptor does not grant market or production authority. */
export const UTILTS_25_A_5_SOURCE = Object.freeze({
  guideRevision: '25-A-5',
  document: '261001_Ediel_UTILTS-APERAK_Anvisning_version_25-A-5',
  filename: '261001_Ediel_UTILTS-APERAK_Anvisning_version_25-A-5.pdf',
  sha256: 'b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2',
  language: 'sv' as const,
  pages: 135,
  published: '2026-10-01',
  effectiveFrom: '2026-10-01',
  locator: 'https://www.ediel.se/Portal/Document/3364',
})

/** Exact qualified editions of the supplied SG5 identity controls. Do not
 * extend these checks to any future guide merely because its number is larger. */
export function hasQualifiedUtiltsOctoberIdentityRules(revision: string): boolean {
  return revision === '25-A-4' || revision === '25-A-5'
}
