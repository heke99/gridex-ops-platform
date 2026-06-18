const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function configuredEdielAutomationActorId(): string {
  const value = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID?.trim() ?? ''
  if (!UUID.test(value)) {
    throw new Error('EDIEL_AUTOMATION_ACTOR_USER_ID måste vara en giltig användaridentitet för automatiska Ediel-åtgärder.')
  }
  return value
}
