/** Internal distribution is a separate capability from the owner's market receipt. */
export type EdielServiceAssessment =
  | { status: 'held'; missing: string[] }
  | { status: 'authorized'; providerCompanyId: string; providerActorId: string; beneficiaryCompanyId: string; assignmentId: string; assignmentVersion: number; environment: 'test' | 'production'; customerId: string; dsoActorId: string; mode: 'V' | 'VH'; purpose: string }
export type EdielProjectionField = 'reading_at' | 'quantity' | 'unit' | 'quality' | 'qualifier' | 'registration_date' | 'resolution' | 'product_id'
export type EdielProjectionRequest = {
  beneficiaryCompanyId: string; actorUserId: string; grantId: string; expectedGrantVersion: number;
  purpose: string; seriesId: string; fields: readonly EdielProjectionField[];
  startInclusive: string; endExclusive: string; limit?: number;
  after?: { readingAt: string; valueId: string } | null
}
export type EdielProjectionPage = { grantId: string; grantVersion: number; seriesId: string; rows: Record<string, unknown>[]; next: { readingAt: string; valueId: string } | null }
