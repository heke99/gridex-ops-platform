const productionProjectRef = 'piidsfebjqjmnepdpnas'

export function stagingProjectTargetError(baseUrl, projectRef) {
  let hostname = ''
  try { hostname = new URL(baseUrl).hostname } catch { /* The exact URL check below rejects malformed input. */ }
  if (projectRef === productionProjectRef || hostname === `${productionProjectRef}.supabase.co`) return 'production'
  if (!/^[a-z0-9]{20}$/.test(projectRef) || baseUrl !== `https://${projectRef}.supabase.co`) return 'unapproved'
  return null
}
