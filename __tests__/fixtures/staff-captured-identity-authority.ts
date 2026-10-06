/**
 * Actual dependency closure for finite fixtures loading current captured staff
 * guards. This is SQL mechanics, not a full native schema or identity fixture.
 * Every declaration, body, RLS switch and function ACL comes from the capture.
 */
export function staffCapturedIdentityAuthoritySql(schema: string): string {
  const table = (name: string): string => {
    const start = schema.indexOf(`CREATE TABLE public.${name} (`)
    const end = schema.indexOf('\n);', start)
    if (start < 0 || end < 0) throw new Error(`Missing captured identity dependency table: ${name}`)
    return schema.slice(start, end + 3)
  }
  const capturedFunction = (name: string): string => {
    const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
    if (start < 0) throw new Error(`Missing captured identity dependency function: ${name}`)
    const delimiter = /\bAS (\$[A-Za-z_0-9]*\$)/.exec(schema.slice(start))
    if (!delimiter || delimiter.index === undefined) throw new Error(`Missing captured identity dependency body: ${name}`)
    const end = schema.indexOf(`${delimiter[1]};`, start + delimiter.index + delimiter[0].length)
    if (end < 0) throw new Error(`Unterminated captured identity dependency function: ${name}`)
    return schema.slice(start, end + delimiter[1].length + 1)
  }
  const functions = ['gridex_staff_assert_external_actor_v1', 'gridex_staff_anchor_invitation_email_v1']
  const tables = ['tenant_customer_identity_providers', 'tenant_staff_actor_anchors', 'tenant_staff_identity_bindings', 'tenant_staff_identity_deliveries']
  const metadata = /^\s+metadata [^\n]+/m.exec(table('integration_api_clients'))?.[0].trim().replace(/,$/, '')
  if (!metadata) throw new Error('Missing captured integration client metadata declaration')
  return [
    `ALTER TABLE public.integration_api_clients ADD COLUMN ${metadata};`,
    ...tables.flatMap(name => {
      const rls = schema.match(new RegExp(`^ALTER TABLE public\\.${name} ENABLE ROW LEVEL SECURITY;$`, 'm'))?.[0]
      if (!rls) throw new Error(`Missing captured identity dependency RLS: ${name}`)
      return [table(name), rls]
    }),
    ...functions.flatMap(name => {
      const acl = schema.match(new RegExp(`^(?:REVOKE|GRANT) [^\\n;]* ON FUNCTION public\\.${name}\\([^\\n;]*\\)[^\\n;]*;`, 'gm'))
      if (!acl?.length) throw new Error(`Missing captured identity dependency ACL: ${name}`)
      return [capturedFunction(name), ...acl]
    }),
  ].join('\n')
}
