// lib/ediel/transportReadiness.ts

export type EdielTransportRouteLike = {
  id: string
  route_name: string
  route_scope: string
  route_type: string
  target_email?: string | null
  target_system?: string | null
  grid_owner_name?: string | null
  grid_owner_ediel_id?: string | null
  is_active: boolean
  profile?: {
    is_enabled: boolean
    sender_ediel_id: string | null
    receiver_ediel_id: string | null
    mailbox: string | null
    sender_sub_address?: string | null
    receiver_sub_address?: string | null
    application_reference?: string | null
    smtp_host?: string | null
    smtp_port?: number | null
    imap_host?: string | null
    imap_port?: number | null
    encryption_mode?: string | null
  } | null
}

export type EdielTransportReadinessIssue = {
  key: string
  severity: 'info' | 'warning' | 'blocked'
  title: string
  description: string
}

export type EdielTransportReadinessSummary = {
  mode: 'file_based'
  smtpEnabled: false
  ecpEnabled: false
  routesTotal: number
  fileReadyRoutes: number
  smtpReadyCandidates: number
  ecpReadyCandidates: number
  blockedIssues: number
  issues: EdielTransportReadinessIssue[]
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0)
}

export function getEdielTransportReadinessSummary(
  routes: EdielTransportRouteLike[]
): EdielTransportReadinessSummary {
  const issues: EdielTransportReadinessIssue[] = []
  const activeEdielRoutes = routes.filter((route) => route.is_active)

  const fileReadyRoutes = activeEdielRoutes.filter((route) => {
    const profile = route.profile
    return Boolean(
      profile?.is_enabled &&
        hasText(profile.sender_ediel_id) &&
        hasText(profile.receiver_ediel_id) &&
        hasText(profile.mailbox)
    )
  }).length

  const smtpReadyCandidates = activeEdielRoutes.filter((route) => {
    const profile = route.profile
    return Boolean(
      profile?.is_enabled &&
        hasText(profile.smtp_host ?? null) &&
        profile.smtp_port &&
        hasText(profile.sender_ediel_id) &&
        hasText(profile.receiver_ediel_id) &&
        hasText(route.target_email)
    )
  }).length

  if (smtpReadyCandidates > 0) {
    issues.push({
      key: 'smtp_candidate_exists',
      severity: 'warning',
      title: 'SMTP-kandidater finns men är inte aktiverade',
      description:
        'Route/profile har SMTP-liknande uppgifter, men Batch 6 kör fortfarande filbaserat. Aktivera inte automatisk sändning förrän certifikat, mailbox och Ediel-test är verifierade.',
    })
  }

  if (fileReadyRoutes === 0) {
    issues.push({
      key: 'no_file_ready_routes',
      severity: 'blocked',
      title: 'Ingen komplett filbaserad Ediel-route hittades',
      description:
        'Minst en aktiv route behöver profil med sender Ediel-ID, receiver Ediel-ID och mailbox/filkanal för att verksamhetsflöden ska kunna köras säkert.',
    })
  }

  issues.push({
    key: 'ecp_future',
    severity: 'info',
    title: 'ECP/EDX ligger kvar som senare steg',
    description:
      'Systemet kan visa readiness, men bygger inte ECP/EDX-transport ännu. Det ska ske efter att filbaserad produktion, certifikat och partnerprofiler är godkända.',
  })

  return {
    mode: 'file_based',
    smtpEnabled: false,
    ecpEnabled: false,
    routesTotal: routes.length,
    fileReadyRoutes,
    smtpReadyCandidates,
    ecpReadyCandidates: 0,
    blockedIssues: issues.filter((issue) => issue.severity === 'blocked').length,
    issues,
  }
}
