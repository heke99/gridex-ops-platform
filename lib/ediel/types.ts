// lib/ediel/types.ts

export type EdielDirection = "inbound" | "outbound";

export type EdielMessageStandard = "edifact" | "xml" | "ai_list";

export type EdielEnvironment = "test" | "production";

export type EdielEnvironmentType =
  | "tgt_test"
  | "agt_test"
  | "bilateral_test"
  | "production";

export type EdielActorSubrole = "DDQ" | "DGI";

export type EdielMessageFamily =
  | "PRODAT"
  | "UTILTS"
  | "APERAK"
  | "CONTRL"
  | "UTILTS_ERR"
  | "AI_LIST"
  | "NBS_XML"
  | "OTHER";

export type EdielMessageStatus =
  | "draft"
  | "prepared"
  | "queued"
  | "sent"
  | "received"
  | "parsed"
  | "validated"
  | "acknowledged"
  | "failed"
  | "cancelled";

export type EdielTransportType =
  | "email"
  | "smtp"
  | "imap"
  | "manual_upload"
  | "api"
  | "sftp"
  | "ecp"
  | "xml"
  | "unknown";

export type EdielAckStatus =
  | "not_required"
  | "pending"
  | "sent"
  | "received"
  | "failed";

export type EdielAckOutcome = "positive" | "negative";

export type EdielMessageCode =
  | "Z01"
  | "Z02"
  | "Z03"
  | "Z04"
  | "Z05"
  | "Z06"
  | "Z09"
  | "Z10"
  | "Z13"
  | "Z14"
  | "Z15"
  | "Z18"
  | "S01"
  | "S02"
  | "S03"
  | "S04"
  | "E31"
  | "E66"
  | "E73"
  | "APERAK"
  | "CONTRL"
  | "UTILTS_ERR"
  | "AI"
  | "BI";

export type EdielKnownMessageCode = EdielMessageCode | string;

export type EdielCanonicalAckState =
  | "awaiting_contrl"
  | "contrl_received"
  | "contrl_failed"
  | "awaiting_aperak"
  | "aperak_received_positive"
  | "aperak_received_negative"
  | "utilts_err_received"
  | "ack_overdue"
  | "no_ack_required"
  | "in_progress"
  | "failed";

export type EdielMessageAckStateRow = {
  id: string;
  direction: EdielMessageRow["direction"];
  message_family: EdielMessageRow["message_family"];
  message_code: string;
  message_version: string | null;
  status: EdielMessageRow["status"];
  environment: EdielMessageRow["environment"];
  requires_contrl: boolean;
  requires_aperak: boolean;
  contrl_status: EdielMessageRow["contrl_status"];
  aperak_status: EdielMessageRow["aperak_status"];
  utilts_err_status: EdielMessageRow["utilts_err_status"];
  ack_due_at: string | null;
  message_sent_at: string | null;
  message_received_at: string | null;
  acknowledged_at: string | null;
  failed_at: string | null;
  canonical_ack_state: EdielCanonicalAckState | string;
};

export const ACTIVE_EDIEL_MESSAGE_FAMILIES = [
  "PRODAT",
  "UTILTS",
  "APERAK",
  "CONTRL",
  "UTILTS_ERR",
  "AI_LIST",
] as const;

export const FUTURE_EDIEL_MESSAGE_FAMILIES = ["NBS_XML", "OTHER"] as const;

export const ACTIVE_EDIEL_TEST_SUITES = [
  "PRODAT",
  "UTILTS",
  "AI_LIST",
] as const;

export const FUTURE_EDIEL_TEST_SUITES = ["NBS_XML", "OTHER"] as const;

export type ActiveEdielMessageFamily =
  (typeof ACTIVE_EDIEL_MESSAGE_FAMILIES)[number];
export type ActiveEdielTestSuite = (typeof ACTIVE_EDIEL_TEST_SUITES)[number];

export function isActiveEdielMessageFamily(
  family: string | null | undefined,
): family is ActiveEdielMessageFamily {
  return Boolean(
    family &&
    (ACTIVE_EDIEL_MESSAGE_FAMILIES as readonly string[]).includes(family),
  );
}

export function isFutureEdielMessageFamily(
  family: string | null | undefined,
): boolean {
  return Boolean(
    family &&
    (FUTURE_EDIEL_MESSAGE_FAMILIES as readonly string[]).includes(family),
  );
}

export function isActiveEdielTestSuite(
  suite: string | null | undefined,
): suite is ActiveEdielTestSuite {
  return Boolean(
    suite && (ACTIVE_EDIEL_TEST_SUITES as readonly string[]).includes(suite),
  );
}

export type EdielMessageRow = {
  id: string;
  company_id?: string | null;
  direction: EdielDirection;
  message_standard: EdielMessageStandard;
  message_family: EdielMessageFamily;
  message_code: EdielKnownMessageCode;
  message_version: string | null;
  process_type: string | null;
  environment: EdielEnvironment;
  test_flag: 0 | 1;
  status: EdielMessageStatus;
  environment_type?: EdielEnvironmentType | string | null;

  transport_type: EdielTransportType;
  mailbox: string | null;
  mailbox_message_id: string | null;
  sender_ediel_id: string | null;
  sender_name: string | null;
  sender_sub_address: string | null;
  receiver_ediel_id: string | null;
  receiver_name: string | null;
  receiver_sub_address: string | null;
  sender_email: string | null;
  receiver_email: string | null;
  subject: string | null;
  file_name: string | null;
  mime_type: string | null;

  interchange_reference: string | null;
  unb_sender_id?: string | null;
  unb_sender_subaddress?: string | null;
  unb_receiver_id?: string | null;
  unb_receiver_subaddress?: string | null;
  message_reference?: string | null;
  bgm_code?: string | null;
  bgm_reference?: string | null;
  tenant_resolution_status?: string | null;
  business_match_status?: string | null;
  ack_status?: string | null;
  processing_status?: string | null;
  external_reference: string | null;
  correlation_reference: string | null;
  transaction_reference: string | null;
  application_reference: string | null;
  original_message_id: string | null;
  original_transaction_id: string | null;
  original_message_code: string | null;
  related_message_id: string | null;

  communication_route_id: string | null;
  outbound_request_id: string | null;
  inbound_email_message_id?: string | null;
  inbound_processing_job_id?: string | null;
  message_intent?: string | null;
  route_scope?: string | null;
  route_decision_payload?: Record<string, unknown> | null;
  switch_request_id: string | null;
  grid_owner_data_request_id: string | null;
  partner_export_id: string | null;

  customer_id: string | null;
  site_id: string | null;
  metering_point_id: string | null;
  grid_owner_id: string | null;

  raw_payload: string | null;
  parsed_payload: Record<string, unknown>;
  validation_report: Record<string, unknown>;

  requires_contrl: boolean;
  requires_aperak: boolean;
  contrl_status: EdielAckStatus | null;
  aperak_status: EdielAckStatus | null;
  utilts_err_status: EdielAckStatus | null;
  ack_outcome: EdielAckOutcome | null;
  syntax_check_status: string | null;
  functional_check_status: string | null;
  failure_reason: string | null;

  message_created_at: string | null;
  message_received_at: string | null;
  message_sent_at: string | null;
  parsed_at: string | null;
  validated_at: string | null;
  acknowledged_at: string | null;
  failed_at: string | null;
  ack_due_at: string | null;

  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type EdielMessageEventType =
  | "created"
  | "prepared"
  | "queued"
  | "sent"
  | "received"
  | "parsed"
  | "validated"
  | "linked"
  | "contrl_sent"
  | "contrl_received"
  | "aperak_sent"
  | "aperak_received"
  | "utilts_err_sent"
  | "utilts_err_received"
  | "failed"
  | "cancelled"
  | "manual_note";

export type EdielMessageEventStatus = "info" | "success" | "warning" | "error";

export type EdielMessageEventRow = {
  id: string;
  company_id?: string | null;
  ediel_message_id: string;
  message_id?: string | null;
  event_type: EdielMessageEventType;
  event_status: EdielMessageEventStatus;
  message: string | null;
  payload: Record<string, unknown>;
  event_payload?: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
};

export type EdielTestRoleCode =
  | "supplier"
  | "grid_owner"
  | "balance_responsible"
  | "brp"
  | "esco"
  | "energy_service_company"
  | "system_supplier";

export type EdielTestSuite =
  | "PRODAT"
  | "UTILTS"
  | "AI_LIST"
  | "NBS_XML"
  | "OTHER";

export type EdielTestRunStatus =
  | "draft"
  | "running"
  | "passed"
  | "failed"
  | "cancelled";

export type EdielTestRunRow = {
  id: string;
  company_id?: string | null;
  approval_version: string | null;
  role_code: EdielTestRoleCode;
  test_suite: EdielTestSuite;
  test_case_code: string;
  title: string | null;
  status: EdielTestRunStatus;

  customer_id: string | null;
  site_id: string | null;
  metering_point_id: string | null;
  grid_owner_id: string | null;

  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  notes: string | null;
  actor_role?: string | null;
  message_family?: string | null;
  business_code?: string | null;
  encryption_mode?: "none" | "smime" | string | null;
  certificate_id?: string | null;
  certificate_fingerprint_sha256?: string | null;
  route_profile_id?: string | null;
  expected_flow?: unknown;
  actual_flow?: unknown;
  raw_edifact?: string | null;
  encrypted_payload_ref?: string | null;
  production_like?: boolean | null;
  environment_type?: EdielEnvironmentType | string | null;
  actor_profile_id?: string | null;
  actor_subrole?: EdielActorSubrole | string | null;
  route_snapshot?: Record<string, unknown> | null;
  actor_snapshot?: Record<string, unknown> | null;
  security_snapshot?: Record<string, unknown> | null;

  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type EdielTestRunMessageRow = {
  id: string;
  test_run_id: string;
  ediel_message_id: string;
  step_no: number | null;
  expected_direction: EdielDirection | null;
  expected_family: string | null;
  expected_code: string | null;
  created_at: string;
};

export type EdielActorRole =
  | "supplier"
  | "grid_owner"
  | "balance_responsible"
  | "brp"
  | "energy_service_company"
  | "service_provider"
  | "system_supplier";

export type EdielActorSettingsRow = {
  id: string;
  company_id?: string | null;
  actor_name: string;
  actor_ediel_id: string;
  actor_role: EdielActorRole;
  ediel_id?: string | null;
  legal_name?: string | null;
  organization_number?: string | null;
  role?: string | null;
  market?: string | null;
  market_roles?: string[] | null;
  default_transport_channel?: string | null;
  production_status?: string | null;
  test_status?: string | null;
  environment: EdielEnvironment;
  environment_type?: EdielEnvironmentType | string | null;
  is_active: boolean;
  actor_subrole?: EdielActorSubrole | string | null;
  sub_role?: EdielActorSubrole | string | null;
  registered_smtp_address?: string | null;
  contact_email?: string | null;
  test_resource_name?: string | null;
  test_resource_email?: string | null;
  is_ombud?: boolean | null;
  prodat_enabled?: boolean | null;
  utilts_enabled?: boolean | null;
  approved_it_system_profile_id?: string | null;
  default_supplier_brp_ediel_id?: string | null;
  default_supplier_brp_name?: string | null;
  production_mode?: "disabled" | "shadow" | "active" | string | null;
  status?: string | null;
  sender_name: string | null;
  sender_sub_address: string | null;
  sender_subaddress?: string | null;
  sender_subaddress_prodat?: string | null;
  sender_subaddress_utilts?: string | null;
  receiver_subaddress?: string | null;
  receiver_message_subaddress?: string | null;
  subaddress_required?: boolean | null;
  default_application_reference: string | null;
  default_timezone: number;
  default_charset: string;
  default_test_flag: 0 | 1;
  smtp_from_email: string | null;
  smtp_reply_to_email: string | null;
  mailbox: string | null;
  brp_name?: string | null;
  brp_ediel_id?: string | null;
  brp_status?: string | null;
  esett_status?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type EdielRouteProfileAckMode =
  | "default"
  | "none"
  | "contrl_only"
  | "contrl_and_aperak";

export type EdielEncryptionMode = "none" | "smime" | "pgp";

export type EdielPayloadFormat = "edifact" | "xml" | "raw";

export type EdielRouteProfileRow = {
  id: string;
  company_id?: string | null;
  communication_route_id: string;
  actor_setting_id?: string | null;
  actor_profile_id?: string | null;
  actor_role?: EdielActorRole | string | null;
  actor_subrole?: EdielActorSubrole | string | null;
  is_enabled: boolean;
  is_active?: boolean | null;
  environment_type?: EdielEnvironmentType | string | null;
  message_family?: string | null;
  message_code?: string | null;
  business_code?: string | null;
  sender_ediel_id: string | null;
  sender_sub_address: string | null;
  sender_subaddress?: string | null;
  own_ediel_id?: string | null;
  own_subaddress?: string | null;
  receiver_ediel_id: string | null;
  receiver_sub_address: string | null;
  receiver_subaddress?: string | null;
  receiver_message_subaddress?: string | null;
  subaddress_required?: boolean | null;
  counterparty_ediel_id?: string | null;
  counterparty_subaddress?: string | null;
  mailbox_id?: string | null;
  transport_type?: string | null;
  transport_mode?: string | null;
  default_brp_ediel_id?: string | null;
  ack_policy?: string | null;
  application_reference: string | null;
  smtp_from?: string | null;
  smtp_to?: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  imap_host: string | null;
  imap_port: number | null;
  mailbox: string | null;
  encryption_mode: EdielEncryptionMode | null;
  signing_mode?: "none" | "smime" | string | null;
  tls_required?: boolean | null;
  certificate_id?: string | null;
  allow_unencrypted_test?: boolean | null;
  allow_unencrypted_production?: boolean | null;
  allow_unencrypted_production_expires_at?: string | null;
  allow_unencrypted_production_granted_by?: string | null;
  allow_unencrypted_production_reason?: string | null;
  security_policy_status?: string | null;
  payload_format: EdielPayloadFormat;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  default_message_version: string | null;
  default_test_flag: 0 | 1;
  default_timezone: number;
  environment: EdielEnvironment;
  message_standard: EdielMessageStandard;
  ack_mode: EdielRouteProfileAckMode;
};

export type EdielMessageRuleRow = {
  id: string;
  message_family: string;
  message_code: string;
  message_standard: EdielMessageStandard;
  version_code: string;
  direction: "inbound" | "outbound" | "both";
  requires_contrl: boolean;
  requires_aperak: boolean;
  supports_negative_response: boolean;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateEdielMessageInput = {
  actorUserId: string;
  companyId?: string | null;
  direction: EdielDirection;
  messageStandard: EdielMessageStandard;
  messageFamily: EdielMessageFamily;
  messageCode: string;
  messageVersion?: string | null;
  processType?: string | null;
  environment?: EdielEnvironment;
  testFlag?: 0 | 1;
  status?: EdielMessageStatus;
  environmentType?: EdielEnvironmentType | string | null;

  transportType?: EdielTransportType;
  mailbox?: string | null;
  mailboxMessageId?: string | null;
  senderEdielId?: string | null;
  senderName?: string | null;
  senderSubAddress?: string | null;
  receiverEdielId?: string | null;
  receiverName?: string | null;
  receiverSubAddress?: string | null;
  senderEmail?: string | null;
  receiverEmail?: string | null;
  subject?: string | null;
  fileName?: string | null;
  mimeType?: string | null;

  interchangeReference?: string | null;
  externalReference?: string | null;
  correlationReference?: string | null;
  transactionReference?: string | null;
  applicationReference?: string | null;
  originalMessageId?: string | null;
  originalTransactionId?: string | null;
  originalMessageCode?: string | null;
  relatedMessageId?: string | null;

  communicationRouteId?: string | null;
  outboundRequestId?: string | null;
  switchRequestId?: string | null;
  gridOwnerDataRequestId?: string | null;
  partnerExportId?: string | null;

  customerId?: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  gridOwnerId?: string | null;

  rawPayload?: string | null;
  parsedPayload?: Record<string, unknown>;
  validationReport?: Record<string, unknown>;

  requiresContrl?: boolean;
  requiresAperak?: boolean;
  contrlStatus?: EdielAckStatus | null;
  aperakStatus?: EdielAckStatus | null;
  utiltsErrStatus?: EdielAckStatus | null;
  ackOutcome?: EdielAckOutcome | null;
  syntaxCheckStatus?: string | null;
  functionalCheckStatus?: string | null;
  failureReason?: string | null;

  messageCreatedAt?: string | null;
  messageReceivedAt?: string | null;
  messageSentAt?: string | null;
  parsedAt?: string | null;
  validatedAt?: string | null;
  acknowledgedAt?: string | null;
  failedAt?: string | null;
  ackDueAt?: string | null;
};

export type CreateEdielMessageEventInput = {
  actorUserId: string;
  edielMessageId: string;
  eventType: EdielMessageEventType;
  eventStatus?: EdielMessageEventStatus;
  message?: string | null;
  payload?: Record<string, unknown>;
};

export type CreateEdielTestRunInput = {
  actorUserId: string;
  companyId?: string | null;
  approvalVersion?: string | null;
  roleCode: EdielTestRoleCode;
  testSuite: EdielTestSuite;
  testCaseCode: string;
  title?: string | null;
  status?: EdielTestRunStatus;
  customerId?: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  gridOwnerId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  failureReason?: string | null;
  notes?: string | null;
  actorRole?: string | null;
  messageFamily?: string | null;
  businessCode?: string | null;
  encryptionMode?: "none" | "smime" | string | null;
  certificateId?: string | null;
  certificateFingerprintSha256?: string | null;
  routeProfileId?: string | null;
  expectedFlow?: unknown;
  actualFlow?: unknown;
  rawEdifact?: string | null;
  encryptedPayloadRef?: string | null;
  productionLike?: boolean | null;
  environmentType?: EdielEnvironmentType | string | null;
  actorProfileId?: string | null;
  actorSubrole?: EdielActorSubrole | string | null;
  routeSnapshot?: Record<string, unknown> | null;
  actorSnapshot?: Record<string, unknown> | null;
  securitySnapshot?: Record<string, unknown> | null;
};

export type UpdateEdielTestRunStatusInput = {
  actorUserId: string;
  testRunId: string;
  status: EdielTestRunStatus;
  failureReason?: string | null;
  completedAt?: string | null;
};

export type AttachEdielMessageToTestRunInput = {
  testRunId: string;
  edielMessageId: string;
  stepNo?: number | null;
  expectedDirection?: EdielDirection | null;
  expectedFamily?: string | null;
  expectedCode?: string | null;
};

export type UpdateEdielMessageStatusInput = {
  actorUserId: string;
  edielMessageId: string;
  status: EdielMessageStatus;
  failureReason?: string | null;
  parsedAt?: string | null;
  validatedAt?: string | null;
  acknowledgedAt?: string | null;
  failedAt?: string | null;
  messageSentAt?: string | null;
  messageReceivedAt?: string | null;
};

export type LinkEdielMessageInput = {
  actorUserId: string;
  edielMessageId: string;
  outboundRequestId?: string | null;
  switchRequestId?: string | null;
  gridOwnerDataRequestId?: string | null;
  partnerExportId?: string | null;
  customerId?: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  gridOwnerId?: string | null;
  relatedMessageId?: string | null;
};

export type EdielMailboxEnvelope = {
  mailboxMessageId: string;
  mailbox?: string | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  payload: string;
};

export type ParsedEdielEnvelope = {
  messageStandard: EdielMessageStandard;
  messageFamily: EdielMessageFamily;
  messageCode: string;
  messageVersion?: string | null;
  processType?: string | null;
  externalReference?: string | null;
  correlationReference?: string | null;
  transactionReference?: string | null;
  applicationReference?: string | null;
  interchangeReference?: string | null;
  originalMessageId?: string | null;
  originalTransactionId?: string | null;
  originalMessageCode?: string | null;
  senderEdielId?: string | null;
  senderName?: string | null;
  senderSubAddress?: string | null;
  receiverEdielId?: string | null;
  receiverName?: string | null;
  receiverSubAddress?: string | null;
  rawPayload: string;
  parsedPayload: Record<string, unknown>;
  validationReport?: Record<string, unknown>;
  requiresContrl?: boolean;
  requiresAperak?: boolean;
  contrlStatus?: EdielAckStatus | null;
  aperakStatus?: EdielAckStatus | null;
  utiltsErrStatus?: EdielAckStatus | null;
  syntaxCheckStatus?: string | null;
  functionalCheckStatus?: string | null;
  messageCreatedAt?: string | null;
  messageReceivedAt?: string | null;
  ackDueAt?: string | null;
};
