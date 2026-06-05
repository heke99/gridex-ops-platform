# Security, Secrets and Certificates

## Secret handling

Never store raw secrets in normal database columns.

Sensitive values must be stored in:

- environment variables
- secret manager
- encrypted storage
- secret_reference pointing to secure storage

Sensitive values include:

- SMTP passwords
- IMAP passwords
- API keys
- private keys
- PFX files
- certificate passwords
- service role keys
- webhook secrets

## Logging rules

Never log:

- raw private keys
- PFX content
- certificate passwords
- SMTP/IMAP passwords
- API keys
- Supabase service role key
- decrypted payloads in public tenant UI unless explicitly allowed and access-controlled

Logs may show:

- certificate fingerprint
- issuer
- serial
- subject
- valid from/to
- route profile id
- Ediel ID
- subaddress
- message reference
- sanitized error reason

## Certificate lifecycle

System should support:

- test certificates
- production certificates
- certificate owner
- certificate purpose: signing, encryption, both if applicable
- environment
- validity dates
- fingerprint
- issuer
- serial
- active/inactive status
- rotation planning
- expiry warnings

## Private certificate/PFX use

Private certificates/PFX must only be used server-side.

When used for inbound decryption:

- match tenant safely before decrypting where possible
- use secure secret reference
- do not expose secret material
- audit decryption attempt result without leaking secrets

## Environment variables and integrations

Any new external integration must document required environment variables.

Do not hardcode credentials, URLs, tokens or tenant-specific secrets.

Integration configuration should support:

- test environment
- production environment
- tenant/company scope where applicable
- enabled/disabled status
- health check/status in admin UI
