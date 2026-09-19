/** Source-approved reporting contract; pure data, no server dependencies. */
export type UUID = string;
export type MarketMinute = string; // validated canonical twelve digits, fixed UTC+1
export type PurposeCode = 'B71' | 'B72' | 'B73' | 'B74' | 'B75' | 'B76';
export type Party = {
    id: string;
    qualifier: string;
    agency: string;
};
export type Installation = {
    id: string;
    agency: '9' | '89';
};
export type Selector = {
    workbook: string;
    sheet: string;
    entityLabel: string;
    columnName: string;
    columnIndex: number;
};
export type SourceIdentity = {
    kind: 'builtin';
    id: string;
    revision: string;
    digest: string;
} | {
    kind: 'dynamic';
    id: UUID;
    revision: string;
    digest: string;
};
export type RunScope = {
    companyId: UUID;
    runId: UUID;
    roleCode: 'esco';
    caseCode: 'E3' | 'E4' | '8.1.1' | '8.1.2' | '8.1.3';
    suite: 'PRODAT';
};
export type StepScope = RunScope & {
    stepNo: number;
    code: 'Z13';
    actor: 'gridex';
    direction: 'outbound';
    environment: 'test';
    runtimeSuite: 'AGT' | 'TGT';
};
export type Ref = {
    kind: 'process' | 'authorization' | 'declaration' | 'classification' | 'assessment';
    key: UUID;
    revision: UUID;
    requestKey: UUID;
};
export type Term = {
    kind: 'unknown';
} | {
    kind: 'indefinite';
    declaration: Ref;
} | {
    kind: 'bounded';
    endMinute: MarketMinute;
    declaration: Ref;
};
export type Classification = {
    kind: 'unknown';
} | {
    kind: 'private' | 'nonprivate';
    record: Ref;
};
export type Purpose = {
    kind: 'unknown';
} | {
    kind: 'absent';
    declaration: Ref;
} | {
    kind: 'assessed';
    code: PurposeCode;
    assessment: Ref;
    legalActor: Party;
    customer: Party;
};
export type RequestPurpose = {
    kind: 'unknown';
} | {
    kind: 'absent';
} | {
    kind: 'present';
    code: PurposeCode;
};
export type RequestOrigin = {
    kind: 'pure_fixture';
    reference: string;
} | {
    kind: 'persisted_request';
    companyId: UUID;
    runId: UUID;
    messageId: UUID;
    source: SourceIdentity;
    bodyDigest: string;
};
export type RequestAssociation = {
    kind: 'unknown';
} | {
    kind: 'known';
    origin: RequestOrigin;
    requestKey: UUID;
    requestRevision: UUID;
    li: string;
    anj: string;
    customer: Party;
    legalRequester: Party;
    process: Ref;
    authorization: Ref;
    reason: 'S17' | 'S18';
    purpose: RequestPurpose;
    allowedInstallations: Installation[];
};
export type ObjectBase = {
    objectKey: UUID;
    requestKey: UUID;
    selector: Selector;
    process: Ref;
    authorization: Ref;
    li: string;
    anj: string;
    customer: Party;
    legalRequester: Party;
    expectedReason: 'S17' | 'S18';
    term: Term;
    classification: Classification;
    purpose: Purpose;
};
export type ReportingObject = (ObjectBase & {
    code: 'Z13';
    installation: null;
    requestAssociation: null;
}) | (ObjectBase & {
    code: 'Z14';
    installation: Installation;
    requestAssociation: RequestAssociation;
});
// N has no positive ReportingObject requirement; classify own wire reason first.
export type OperatorTerm = {
    kind: 'unknown';
} | {
    kind: 'indefinite';
} | {
    kind: 'bounded';
    end: string;
} | {
    kind: 'bounded_source';
    minuteOfDay: string;
}; // exact HHmm
// No operator-authored reference is accepted as assessment authority.
export type OperatorPurpose = {
    kind: 'unknown';
} | {
    kind: 'absent';
} | {
    kind: 'assessed';
    code: PurposeCode;
    rationale: string;
};
export type OperatorAssertion = {
    selector: Selector;
    term: OperatorTerm;
    classification: 'unknown' | 'private' | 'nonprivate';
    classificationRationale: string;
    purpose: OperatorPurpose;
};
export type OperatorCommand = {
    operation: 'save';
    resolution: 'retain' | 'refresh';
    sourceNote: string;
    objects: OperatorAssertion[];
} | {
    operation: 'clear';
    sourceNote: string;
};
// Action arguments outside assertion JSON are selectors/CAS tokens, not authority.
export type ActionInput = {
    testRunId: UUID;
    stepNo: number;
    expectedRunUpdatedAt: string;
    command: OperatorCommand;
};
export type Route = {
    settingsId: UUID;
    actorSettingId: UUID;
    routeProfileId: UUID | null;
    communicationRouteId: UUID | null;
    transportProfileId: UUID | null;
    legalSender: Party;
    legalRecipient: Party;
    senderId: string;
    receiverId: string;
    senderQualifier: string;
    receiverQualifier: string;
    senderSubaddress: string | null;
    receiverSubaddress: string | null;
    applicationReference: string;
    transportType: 'manual_upload';
    mailbox: string | null;
    receiverEmail: string | null;
};
export type StoredAssertion = {
    selector: Selector;
    assertion: OperatorAssertion;
    resolutionAnchorUtcMs: number;
    resolvedEndMinute: MarketMinute | null;
    sourceExpression: string | null;
    object: ReportingObject;
};
export type ActiveStep = {
    state: 'active';
    code: 'Z13';
    factsRevision: UUID;
    source: SourceIdentity;
    routeAtApproval: Route;
    actorId: UUID;
    sourceNote: string;
    recordedAtUtcMs: number;
    objects: StoredAssertion[];
};
export type ClearedStep = {
    state: 'cleared';
    code: 'Z13';
    factsRevision: UUID;
    actorId: UUID;
    sourceNote: string;
    recordedAtUtcMs: number;
};
export type StoredNotes = {
    version: 1;
    scope: RunScope;
    steps: Record<string, ActiveStep | ClearedStep>;
}; // canonical positive step string
// Stored only at top-level notes.prodatReportingPermission; no old envelope changes.
export type ServerSource = {
    kind: 'tgt';
    scope: StepScope;
    source: SourceIdentity;
    factsRevision: UUID;
    actorId: UUID;
    sourceNote: string;
    route: Route;
};
export type TgtEvidence = {
    source: ServerSource;
    objects: ReportingObject[];
};
export type PureSelection = {
    source: {
        kind: 'caller_selection';
        reference: string;
    };
    objects: ReportingObject[];
    evaluationUtcMs: number;
};
export type ExpectedContext = {
    source: ServerSource;
    objects: ReportingObject[];
    evaluationUtcMs: number;
};
export type BuildResolution = {
    evidence: TgtEvidence | null;
    expected: ExpectedContext | null;
};
export type ReportingSelection = PureSelection | TgtEvidence;
export type ReportingClock = {
    nowUtcMs(): number;
};
