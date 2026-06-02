export type CertificateStatusInput = {
  valid_from?: string | null
  valid_to?: string | null
  certificate_valid_from?: string | null
  certificate_valid_to?: string | null
  renewal_window_days?: number | null
  warning_days_before_expiry?: number | null
  critical_days_before_expiry?: number | null
  status?: string | null
}

export type CertificateRenewalStatus =
  | 'active'
  | 'renewal_available'
  | 'expiring'
  | 'critical'
  | 'expired'
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

export function evaluateCertificateStatus(
  input: CertificateStatusInput,
  now: Date = new Date()
): CertificateStatusEvaluation {
  const validFrom = parseDate(input.valid_from ?? input.certificate_valid_from)
  const validTo = parseDate(input.valid_to ?? input.certificate_valid_to)
  const renewalWindowDays = input.renewal_window_days ?? 60
  const warningDays = input.warning_days_before_expiry ?? 45
  const criticalDays = input.critical_days_before_expiry ?? 14

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

  if (!validTo) {
    return {
      status: 'validation_failed',
      isUsableForSmime: false,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: null,
      daysUntilExpiry: null,
      renewalAvailableFrom: null,
      message: 'Certifikatet saknar giltigt slutdatum.',
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
