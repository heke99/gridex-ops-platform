/**
 * Gridex Ediel v2 — FÖRESLAGET INTERNT TYPKONTRAKT.
 *
 * Inte en Ediel-validerare eller färdig implementation. Inga nätanrop eller
 * databasändringar görs här. Anpassa namn till befintliga auktoritativa tabeller.
 * En TypeScript-brand ersätter inte servervalidering, RLS, transaktioner eller
 * kryptografiskt/verifierbart beslutsbevis. Beslut från klienter är aldrig betrodda.
 *
 * Läs MASTERMASTERPLAN_v2.md och de versionsriktiga nationella originalkällorna.
 */
export type TenantId = string;
export type ActorId = string;
export type Instant = string; // Validerat RFC3339, inte en godtycklig sträng från klienten.
export type LocalDate = string; // Validerat kalenderdatum YYYY-MM-DD.
export type Environment = 'test' | 'production';
export type Market = 'EL'; // GAS kräver ett separat aktiverat protokoll-/verksamhetsscope.
export type OperatingRole = 'SUPPLIER' | 'ESCO';
export type Direction = 'inbound' | 'outbound';
export type Family = 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL';
export type Assessment<T> =
  | { status: 'determined'; value: T; evidenceIds: readonly string[] }
  | { status: 'missing_evidence'; missing: readonly string[] }
  | { status: 'conflict'; alternatives: readonly T[]; evidenceIds: readonly string[] };

export interface QualifiedPartyId {
  value: string;
  qualifier: string;
  responsibleAgency: string | null;
}
export interface PartyContext {
  actorId: ActorId;
  legalParty: QualifiedPartyId;
  interchangeParty: QualifiedPartyId;
  subAddress: string | null; // Null är ett korrekt värde när registrerad subadress saknas.
  registrySnapshotId: string;
  technicalRepresentationId: string | null;
}

export type ServiceModel =
  | {
      model: 'tenant_own_market_actor';
      marketTenantId: TenantId;
      marketActorId: ActorId;
    }
  | {
      model: 'provider_legal_esco';
      marketTenantId: TenantId;
      marketActorId: ActorId;
      serviceAssignmentIds: readonly string[];
      // En marknadshändelse kan ge flera interna projektioner, aldrig flera
      // upstream-kvittenser enbart på grund av antalet beneficiaries.
    };

export interface AuthorizedExecutionContext {
  environment: Environment;
  market: Market;
  service: ServiceModel;
  operatingRole: OperatingRole;
  actingUserOrServiceId: string;
  ownParty: PartyContext;
  counterparty: PartyContext;
  processId: string;
  processVersion: number;
  authorizationEvidenceIds: readonly string[];
  authorizationVersion: string;
  bilateralCapabilityIds: readonly string[]; // Serverhärledda, scopade, giltiga vid relevant tid.
  establishedAt: Instant;
}

export interface BeneficiaryGrant {
  id: string;
  providerTenantId: TenantId;
  beneficiaryTenantId: TenantId;
  providerActorId: ActorId;
  serviceAssignmentId: string;
  marketPermissionId: string;
  objectIds: readonly string[];
  productIds: readonly string[];
  allowedFieldSets: readonly string[];
  purposes: readonly string[];
  dataPeriod: { startInclusive: Instant; endExclusive: Instant | null };
  accessValidFrom: Instant;
  accessValidTo: Instant | null;
  version: number;
  status: 'active' | 'revoked' | 'expired';
  downstreamUseEvidenceIds: readonly string[];
}

export interface RuleReference {
  id: string;
  sourceId: string;
  sourceHash: string;
  section: string;
  page: number | null;
  authority: 'national_rule' | 'handbook_process' | 'bilateral' | 'internal_architecture';
}
export interface VersionDecision {
  rulePackId: string;
  rulePackHash: string;
  wireVersion: string;
  nationalGuideRevision: string;
  documentCreatedAt: Instant | null;
  plannedSendAt: Instant | null;
  actualSendAt: Instant | null;
  recipientAvailableAt: Instant | null;
  localIngressAt: Instant | null;
  businessEffectiveDate: LocalDate | null;
  measurementPeriod: { startInclusive: Instant; endExclusive: Instant } | null;
  // Ingen generell fallback till dagens datum för alla slags regler.
  ruleAnchors: readonly {
    ruleId: string;
    anchorKind: string;
    resolvedValue: Instant | LocalDate;
    timeBasis: 'UTC' | 'Europe/Stockholm' | 'fixed_UTC_plus_1' | 'other_source_defined';
    reason: string;
  }[];
  acceptedInboundRevisionIds: readonly string[];
  transitionEvidenceIds: readonly string[];
}

export interface ProtocolProfile {
  family: Family;
  code: string;
  subtype: string | null;
  wireReason: string | null;
  direction: Direction;
  applicationReference: string | null;
  // APERAK och UTILTS-ERR måste binds till rätt originalfamilj och profil.
  originalProfileId: string | null;
  requestedMessageCode: string | null;
  fieldProfileId: string;
  syntaxGrammarId: string;
  acknowledgementPolicyId: string;
  processPolicyId: string;
  versions: VersionDecision;
  appliedRules: readonly RuleReference[];
}

export interface WireLocator {
  messageIndex: number;
  segmentGroupPath: readonly string[];
  segmentIndex: number;
  segmentTag: string;
  qualifier: string | null;
  elementIndex: number | null;
  componentIndex: number | null;
  occurrence: number | null;
}
export type ScopeReference =
  | { level: 'interchange'; interchangeRef: string }
  | { level: 'message'; interchangeRef: string; unhRef: string; bgmId: string | null }
  | { level: 'prodat_object'; bgmId: string; lineNumber: string; objectId: string | null; caseRef: string | null }
  | { level: 'utilts_transaction'; bgmId: string; transactionId: string; objectId: string | null };

export interface ValidationIssue {
  rule: RuleReference;
  scope: ScopeReference;
  layer: 'syntax' | 'national_header' | 'national_object' | 'national_transaction' | 'processability' | 'internal';
  locator: WireLocator | null;
  // Det riktiga numret/koden följer med kontrollen. Det utvinns inte ur DTM-text.
  applicationFieldReference: string | null;
  externalError: null | {
    responseProfile: 'CONTRL' | 'APERAK_PRODAT' | 'APERAK_UTILTS' | 'UTILTS_ERR';
    code: string;
    detailCode: string | null;
  };
  description: string;
}

export type UtiltsDisposition =
  | { kind: 'guide_rejected'; transactionId: string; issues: readonly ValidationIssue[] }
  | { kind: 'processability_rejected'; transactionId: string; issues: readonly ValidationIssue[] }
  | { kind: 'accepted_stored'; transactionId: string; dataVersionId: string; storageReceiptId: string }
  | { kind: 'accepted_older'; transactionId: string; handlingReceiptId: string; currentVersionId: string }
  | { kind: 'internal_pending'; transactionId: string; blockerId: string };

export interface AcknowledgementIntent {
  id: string;
  profile: 'CONTRL' | 'APERAK_PRODAT' | 'APERAK_UTILTS' | 'UTILTS_ERR';
  polarity: 'positive' | 'negative' | 'prodat_object_mixed';
  originalScopes: readonly ScopeReference[];
  ruleIds: readonly string[];
  issues: readonly ValidationIssue[];
  // U-positivt och U-negativt får inte blandas. P följer sin egen objektslogik.
  storageEvidenceIds: readonly string[];
  deadlineId: string | null;
}

export interface MutationPlan {
  id: string;
  contextVersion: number;
  marketTenantId: TenantId;
  processId: string;
  permittedOperations: readonly {
    handlerId: string;
    idempotencyKey: string;
    entityId: string;
    expectedEntityVersion: number | null;
    ruleIds: readonly string[];
  }[];
  eventIds: readonly string[];
  outboxIntentIds: readonly string[];
}

export interface DecisionBody {
  id: string;
  context: AuthorizedExecutionContext;
  profile: ProtocolProfile;
  sourcePayloadHash: string | null;
  assessedAt: Instant;
  contextFingerprint: string;
  dependencyVersions: Readonly<Record<string, string>>;
  result: 'approved' | 'blocked' | 'requires_resolution';
  issues: readonly ValidationIssue[];
  mutationPlan: MutationPlan | null;
  acknowledgementIntents: readonly AcknowledgementIntent[];
  nextActions: readonly { actionId: string; dueAt: Instant | null; ruleIds: readonly string[]; ownerScope: string }[];
}

declare const operational: unique symbol;
export type OperationalDecision = Readonly<DecisionBody> & {
  readonly mode: 'live_inbound' | 'live_outbound';
  readonly [operational]: true; // Endast serverns verifierade beslutsgateway ska kunna utfärda denna typ.
};
export type NonOperationalDecision = Readonly<DecisionBody> & {
  readonly mode: 'catalog_evidence' | 'historical_replay' | 'shadow_validation';
};
export interface PreparedPayload {
  decisionId: string;
  rawArchiveId: string;
  rawSha256: string;
  mimeArchiveId: string;
  mimeSha256: string;
  rfcMessageId: string;
  interchangeRef: string;
}
export type SubmissionResult =
  | { status: 'smtp_accepted'; attemptId: string; providerQueueId: string | null; serverResponse: string; acceptedAt: Instant }
  | { status: 'smtp_rejected'; attemptId: string; serverResponse: string; rejectedAt: Instant }
  | { status: 'submission_unknown'; attemptId: string; lastConfirmedPhase: string; traceEvidenceIds: readonly string[] };

/** Kontrakt för verkliga serverimplementationer; deklarationer, inte körbar motor. */
export interface EdielServices {
  authorizeCommand(input: unknown): Promise<Assessment<AuthorizedExecutionContext>>;
  resolveProtocol(context: AuthorizedExecutionContext, input: unknown): Assessment<ProtocolProfile>;
  decide(context: AuthorizedExecutionContext, profile: ProtocolProfile, input: unknown): Promise<OperationalDecision>;
  applyTransaction(decision: OperationalDecision): Promise<{ receiptId: string }>;
  prepareOutbound(decision: OperationalDecision): Promise<PreparedPayload>;
  revalidateBeforeSend(decisionId: string): Promise<Assessment<OperationalDecision>>;
  submit(decision: OperationalDecision, payload: PreparedPayload): Promise<SubmissionResult>;
  projectToBeneficiary(decisionId: string, grantId: string, grantVersion: number): Promise<{ projectionReceiptId: string }>;
}
