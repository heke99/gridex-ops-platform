import type { NextRequest } from 'next/server'

const ALLOW = 'OPTIONS, POST'

export function createStaffOnboardingMethodRejection(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    // Both onboarding handlers reject non-POST requests before any authority or data access.
    const response = await handler(request)
    response.headers.set('Allow', ALLOW)
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response
  }
}

export function staffOnboardingOptions(): Response {
  // Next would advertise the explicit rejection handlers in its automatic OPTIONS response.
  return new Response(null, { status: 204, headers: { Allow: ALLOW } })
}
