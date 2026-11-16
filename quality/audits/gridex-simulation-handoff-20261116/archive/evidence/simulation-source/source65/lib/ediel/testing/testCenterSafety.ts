export const EDIEL_TEST_CENTER_ALLOWED_ENVIRONMENT_TYPES = [
  'tgt_test',
  'agt_test',
  'bilateral_test',
] as const

export type EdielTestCenterEnvironmentType =
  (typeof EDIEL_TEST_CENTER_ALLOWED_ENVIRONMENT_TYPES)[number]

export type EdielTestCenterIsolation = {
  environment: 'test'
  environmentType: EdielTestCenterEnvironmentType
  productionLike: boolean
  externalSideEffectsAllowed: false
}

export function resolveEdielTestCenterIsolation(input: {
  environmentType?: string | null
  productionLike?: boolean
}): EdielTestCenterIsolation {
  const environmentType = String(input.environmentType ?? 'agt_test')
    .trim()
    .toLowerCase()

  if (environmentType === 'production') {
    throw new Error(
      'Test Center får aldrig köras mot produktionsmiljö. Använd produktionslikt test i isolerad testmiljö.',
    )
  }

  if (
    !EDIEL_TEST_CENTER_ALLOWED_ENVIRONMENT_TYPES.includes(
      environmentType as EdielTestCenterEnvironmentType,
    )
  ) {
    throw new Error(`Ogiltig Test Center-miljö: ${environmentType || 'saknas'}.`)
  }

  return {
    environment: 'test',
    environmentType: environmentType as EdielTestCenterEnvironmentType,
    productionLike: Boolean(input.productionLike),
    externalSideEffectsAllowed: false,
  }
}
