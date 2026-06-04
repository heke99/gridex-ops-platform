export type CertificateStatusInput = {
  valid_from?: string | null
  valid_to?: string | null
  certificate_valid_from?: string | null
  certificate_valid_to?: string | null
  renewal_window_days?: number | null
  warning_days_before_expiry?: number | null
  critical_days_before_expiry?: number | null
  status?: string | null
  encryption_status?: string | null
  usage?: string | null
  purpose?: string | null
  p12_secret_reference?: string | null
  p12SecretReference?: string | null
  secret_reference?: string | null
  is_private_material_available?: boolean | null
  metadata?: Record<string, unknown> | null
}

export type CertificateRenewalStatus =
  | 'active'
  | 'renewal_available'
  | 'expiring'
  | 'critical'
  | 'expired'
  | 'pending_identifier'
  | 'runtime_validation_required'
  | 'validation_failed'

export type CertificateStatusEvaluation = {
  status: CertificateRenewalStatus
  isUsableForSmime: boolean
  validFrom: string | null
  validTo: string | null
  daysUntilExpiry: number | null
  renewalAvailableFrom: string | null
  message: string
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function metadataText(input: CertificateStatusInput, ...keys: string[]): string | null {
  const meta = input.metadata && typeof input.metadata === 'object' ? input.metadata : null
  if (!meta) return null
  for (const key of keys) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function hasEnvP12Reference(input: CertificateStatusInput): boolean {
  const reference =
    input.p12_secret_reference ??
    input.p12SecretReference ??
    input.secret_reference ??
    metadataText(
      input,
      'p12SecretReference',
      'p12_secret_reference',
      'p12SecretRef',
      'p12_secret_ref',
      'p12Base64Env',
      'p12Env',
    )
  return typeof reference === 'string' && reference.trim().startsWith('env:')
}

function isInboundPrivateEnvReference(input: CertificateStatusInput): boolean {
  const usage = String(input.usage ?? metadataText(input, 'usage') ?? '').toLowerCase()
  const dbStatus = String(input.status ?? '').toLowerCase()
  return (
    usage === 'inbound_private' &&
    dbStatus !== 'archived' &&
    dbStatus !== 'deleted' &&
    dbStatus !== 'inactive' &&
    hasEnvP12Reference(input)
  )
}

export function evaluateCertificateStatus(
  input: CertificateStatusInput,
  now: Date = new Date()
): CertificateStatusEvaluation {
  const validFrom = parseDate(input.valid_from ?? input.certificate_valid_from)
  const validTo = parseDate(input.valid_to ?? input.certificate_valid_to)
  const renewalWindowDays = input.renewal_window_days ?? 60
  const warningDays = input.warning_days_before_expiry ?? 45
  const criticalDays = input.critical_days_before_expiry ?? 14

  if (String(input.status ?? '').toLowerCase() === 'pending_identifier') {
    return {
      status: 'pending_identifier',
      isUsableForSmime: false,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo?.toISOString() ?? null,
      daysUntilExpiry: null,
      renewalAvailableFrom: null,
      message: 'Unik identifierare är sparad. Väntar på certifikat/PEM/P12 innan S/MIME kan användas.',
    }
  }

  if (String(input.status ?? '').toLowerCase() === 'validation_failed') {
    return {
      status: 'validation_failed',
      isUsableForSmime: false,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo?.toISOString() ?? null,
      daysUntilExpiry: null,
      renewalAvailableFrom: null,
      message: 'Certifikatets validering misslyckades.',
    }
  }

  if (!validTo && isInboundPrivateEnvReference(input)) {
    return {
      status: 'runtime_validation_required',
      isUsableForSmime: true,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: null,
      daysUntilExpiry: null,
      renewalAvailableFrom: null,
      message:
        'Env-referens aktiv för inbound S/MIME. Klicka Validera P12 från env för att läsa giltighetstid och fingerprint.',
    }
  }

  if (!validTo) {
    return {
      status: 'validation_failed',
      isUsableForSmime: false,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: null,
      daysUntilExpiry: null,
      message: 'Certifikatet saknar giltigt slutdatum.',
      renewalAvailableFrom: null,
    }
  }

  const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / MS_PER_DAY)
  const renewalAvailableFrom = new Date(validTo.getTime() - renewalWindowDays * MS_PER_DAY)

  if (daysUntilExpiry < 0) {
    return {
      status: 'expired',
      isUsableForSmime: false,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo.toISOString(),
      daysUntilExpiry,
      renewalAvailableFrom: isoDate(renewalAvailableFrom),
      message: 'Certifikatet har gått ut.',
    }
  }

  if (daysUntilExpiry <= criticalDays) {
    return {
      status: 'critical',
      isUsableForSmime: true,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo.toISOString(),
      daysUntilExpiry,
      renewalAvailableFrom: isoDate(renewalAvailableFrom),
      message: 'Certifikatet går ut mycket snart.',
    }
  }

  if (daysUntilExpiry <= warningDays) {
    return {
      status: 'expiring',
      isUsableForSmime: true,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo.toISOString(),
      daysUntilExpiry,
      renewalAvailableFrom: isoDate(renewalAvailableFrom),
      message: 'Certifikatet går snart ut.',
    }
  }

  if (now.getTime() >= renewalAvailableFrom.getTime()) {
    return {
      status: 'renewal_available',
      isUsableForSmime: true,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo.toISOString(),
      daysUntilExpiry,
      renewalAvailableFrom: isoDate(renewalAvailableFrom),
      message: 'Certifikatet är aktivt och kan förnyas.',
    }
  }

  return {
    status: 'active',
    isUsableForSmime: true,
    validFrom: validFrom?.toISOString() ?? null,
    validTo: validTo.toISOString(),
    daysUntilExpiry,
    renewalAvailableFrom: isoDate(renewalAvailableFrom),
    message: 'Certifikatet är aktivt.',
  }
}
