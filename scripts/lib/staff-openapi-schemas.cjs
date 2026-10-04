/* Canonical staff documentation schemas. Generated documents are never edited by hand. */
const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const str = { type: 'string' }
const nullable = { type: ['string', 'null'] }
const timestamp = { type: 'string', format: 'date-time' }
const nullableTimestamp = { type: ['string', 'null'], format: 'date-time' }
const bool = { type: 'boolean' }
const strings = { type: 'array', items: str, uniqueItems: true }
const opaque = { type: 'string', minLength: 1, maxLength: 200, description: 'Opaque organization-scoped reference. It is not a native database UUID or an authorization grant.' }
const resourceReference = (kind) => ({ ...opaque, pattern: `^${kind}_[A-Za-z0-9_-]{20,64}$` })
const optionalText = (maxLength) => ({ type: ['string', 'null'], minLength: 1, maxLength, pattern: '^(?![\\s\\S]*\\u0000)(?=[\\s\\S]*\\S)[\\s\\S]+$' })
const requiredText = (maxLength) => ({ ...optionalText(maxLength), type: 'string' })
const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const priority = { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }
const status = { type: 'string', enum: ['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'] }
const closed = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties })
const fields = (names, schema = nullable) => Object.fromEntries(names.split(' ').map((name) => [name, { ...schema }]))

function staffSchemas(version, capabilities) {
  const versionSchema = { type: 'string', const: version }
  const envelope = (data, page = false) => closed({ data, ...(page ? { page: ref('StaffPage') } : {}), request_id: str, correlation_id: str, contract_schema_version: versionSchema })
  const factor = closed({ factor_reference: opaque, method: { type: 'string', const: 'totp' }, friendly_name: nullable })
  const summary = closed({ customer_reference: opaque, ...fields('customer_number customer_type status email phone'), display_name: nullable, created_at: nullableTimestamp })
  const schemas = {
    StaffErrorBlocker: closed({ code: str, message: str, field: nullable, resource_type: nullable, count: { type: ['number', 'null'] }, recommended_action: nullable }, ['code', 'message']),
    StaffErrorEnvelope: closed({ error: closed({ code: str, message: str, retryable: bool, field: nullable, blockers: { type: 'array', items: ref('StaffErrorBlocker') } }), request_id: str, correlation_id: str, contract_schema_version: versionSchema }),
    StaffPage: closed({ limit: { type: 'integer', minimum: 1, maximum: 100 }, returned: { type: 'integer', minimum: 0, maximum: 100 }, has_more: bool, next_cursor: nullable }),
    StaffSessionRequest: closed({ email: { type: 'string', format: 'email', minLength: 3, maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 1024, writeOnly: true } }),
    StaffRefreshRequest: closed({ refresh_token: { type: 'string', minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$', writeOnly: true } }),
    StaffLogoutRequest: closed({ refresh_token: { type: 'string', minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$', writeOnly: true } }, []),
    StaffMfaChallengeRequest: closed({ factor_reference: { type: 'string', pattern: '^mfa_[a-f0-9]{32}$' } }),
    StaffMfaVerifyRequest: closed({ challenge_reference: { type: 'string', pattern: '^mch_[a-f0-9]{32}$' }, code: { type: 'string', pattern: '^[0-9]{6}$', writeOnly: true } }),
    StaffPasswordRequest: closed({ password: { type: 'string', minLength: 12, maxLength: 1024, writeOnly: true } }),
    StaffRecoveryRequest: closed({ email: { type: 'string', format: 'email', minLength: 3, maxLength: 254 } }),
    StaffRecoveryVerifyRequest: closed({ token_hash: { type: 'string', minLength: 16, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$', writeOnly: true } }),
    StaffSessionReceipt: closed({
      status: { type: 'string', enum: ['authenticated', 'mfa_required', 'password_change_required'] },
      staff_access_token: { type: 'string', maxLength: 4096, description: 'OPS-issued short-lived personal proof; trusted BFF only. Native Auth tokens remain inside OPS.' },
      refresh_token: { type: 'string', description: 'Opaque rotating refresh credential; trusted BFF only.' },
      token_type: { type: 'string', const: 'Bearer' }, expires_in: { type: 'integer', const: 300 },
      expires_at: timestamp, refresh_expires_at: timestamp, session_reference: opaque, staff_reference: opaque,
      organization_reference: opaque, factors: { type: 'array', items: factor },
    }),
    StaffContext: closed({ staff_reference: opaque, display_name: nullable, organization_reference: opaque, is_platform_admin: bool, permissions: strings, capabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: capabilities.filter(value => value !== 'staff.sessions') } } }),
    StaffMfaChallenge: closed({ challenge_reference: opaque, method: { type: 'string', const: 'totp' }, expires_at: timestamp }),
    StaffLogoutReceipt: closed({ logged_out: { type: 'boolean', const: true } }),
    StaffRecoveryReceipt: closed({ accepted: { type: 'boolean', const: true } }),
    StaffCustomerSummary: summary,
    StaffCustomerDetail: closed({ ...summary.properties, ...fields('first_name last_name company_name masked_personal_number org_number apartment_number preferred_language'), updated_at: nullableTimestamp, moved_out_at: nullableTimestamp, lifecycle_closed_at: nullableTimestamp }),
    StaffCustomerContact: closed({ contact_reference: opaque, ...fields('type name email phone title'), is_primary: { type: ['boolean', 'null'] }, created_at: nullableTimestamp }),
    StaffCustomerAddress: closed({ address_reference: opaque, ...fields('type street_1 street_2 postal_code city country municipality moved_in_at moved_out_at'), is_active: { type: ['boolean', 'null'] }, created_at: nullableTimestamp }),
    StaffCustomerFacility: closed({ facility_reference: opaque, ...fields('site_name facility_id site_type status street care_of postal_code city country grid_area_code price_area_code move_in_date move_out_date'), created_at: nullableTimestamp, updated_at: nullableTimestamp }),
    StaffAssignee: closed({ staff_reference: opaque, display_name: str }),
    StaffSupportCase: closed({
      case_reference: opaque, customer_reference: opaque, ...fields('customer_number customer_display_name facility_reference'),
      title: str, description: nullable, description_visibility: { type: 'string', enum: ['internal', 'customer'] }, category: nullable,
      status: str, public_status: { type: 'string', enum: ['received', 'in_progress', 'resolved', 'closed'] }, priority,
      channel: nullable, assigned_to: { anyOf: [ref('StaffAssignee'), { type: 'null' }] }, next_action: nullable,
      next_action_due_at: nullableTimestamp, created_at: timestamp, updated_at: timestamp, resolved_at: nullableTimestamp, closed_at: nullableTimestamp,
    }),
    StaffSupportEntry: closed({
      entry_reference: opaque, case_reference: opaque, kind: { type: 'string', enum: ['customer_message', 'staff_reply', 'internal_note', 'phone_interaction', 'created', 'status_changed', 'assignment_changed'] },
      visibility: { type: 'string', enum: ['internal', 'customer'] }, author_type: { type: 'string', enum: ['customer', 'staff', 'system'] },
      author: { anyOf: [ref('StaffAssignee'), { type: 'null' }] }, body: nullable, created_at: nullableTimestamp,
      reply_kind: { type: 'string', enum: ['message', 'phone_summary'] }, status: nullable, assignee_reference: nullable,
    }, ['entry_reference', 'case_reference', 'kind', 'visibility', 'author_type', 'author', 'body', 'created_at']),
    StaffCaseCreateRequest: closed({ customer_reference: resourceReference('customer'), title: requiredText(180), description: optionalText(8000), category: optionalText(120), priority: { ...priority, default: 'normal' }, facility_reference: { anyOf: [resourceReference('facility'), { type: 'null' }] } }, ['customer_reference', 'title']),
    StaffReplyRequest: closed({ message: requiredText(8000), kind: { type: 'string', enum: ['message', 'phone_summary'], default: 'message' } }, ['message']),
    StaffNoteRequest: closed({ message: requiredText(8000) }),
    StaffStatusRequest: closed({ status, expected_updated_at: timestamp, message: optionalText(8000) }, ['status', 'expected_updated_at']),
    StaffAssignmentRequest: closed({ assignee_reference: { anyOf: [resourceReference('staff'), { type: 'null' }] }, expected_updated_at: timestamp }),
    StaffCaseCreatedReceipt: closed({ case_reference: opaque, customer_reference: opaque, status: str, priority, created_at: timestamp, updated_at: timestamp }),
    StaffCaseMutationReceipt: closed({ case_reference: opaque, status: str, assigned_to: nullable, updated_at: timestamp, entry_reference: opaque }),
    StaffSupportAttachment: closed({ case_reference: opaque, attachment_reference: opaque, file_name: str, mime_type: nullable, byte_size: { type: 'integer', minimum: 1, maximum: 10485760, description: 'Existing approved attachments can be up to 10 MiB; new staff uploads are capped at 4 MiB.' }, sha256, visibility: { type: 'string', enum: ['internal', 'customer'] }, uploaded_by: { type: 'string', enum: ['staff', 'customer'] }, scan_status: { type: 'string', enum: ['quarantined', 'released', 'rejected'] }, scan_reason: nullable, created_at: timestamp }),
    StaffAttachmentUploadRequest: closed({ file: { type: 'string', format: 'binary', 'x-max-bytes': 4194304 }, visibility: { type: 'string', enum: ['internal', 'customer'], default: 'internal' } }, ['file']),
    StaffReleaseManifest: closed({
      schema_version: { type: 'integer', const: 1 }, contract_name: { type: 'string', const: 'staff-support-v1' },
      contract_version: versionSchema, minimum_staff_integration_version: versionSchema, guide_version: versionSchema,
      released_at: timestamp, build_commit: str, capabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: capabilities } },
      specification: closed({ url: { type: 'string', format: 'uri' }, immutable_url: { type: 'string', format: 'uri' }, sha256 }),
    }),
  }
  for (const name of ['StaffSessionReceipt', 'StaffContext', 'StaffMfaChallenge', 'StaffLogoutReceipt', 'StaffRecoveryReceipt', 'StaffCustomerDetail', 'StaffSupportCase', 'StaffSupportEntry', 'StaffCaseCreatedReceipt', 'StaffCaseMutationReceipt', 'StaffSupportAttachment']) schemas[`${name}Envelope`] = envelope(ref(name))
  for (const name of ['StaffCustomerSummary', 'StaffCustomerContact', 'StaffCustomerAddress', 'StaffCustomerFacility', 'StaffSupportCase', 'StaffSupportEntry', 'StaffAssignee', 'StaffSupportAttachment']) schemas[`${name}Page`] = envelope({ type: 'array', items: ref(name) }, true)
  return schemas
}

module.exports = { staffSchemas, closed, ref, opaque, resourceReference }
