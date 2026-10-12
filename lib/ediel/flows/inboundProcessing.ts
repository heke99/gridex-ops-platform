import {hasReceivedZ04HStructuralFieldRejection} from '@/lib/ediel/prodat/receivedZ04HStructuralFieldRejection'
import {hasReceivedZ04HRequiredFieldRejection} from '@/lib/ediel/prodat/receivedZ04HRequiredFieldRejection'
import {hasReceivedZ04HRegisterRejection} from '@/lib/ediel/prodat/receivedZ04HRegisterRejection';
import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages';
import {createReceivedSourceOwnerSession, type SourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import type {SourceSwitchCommitObserver} from './sourceSwitchCommit'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger';
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence';
import {hasReceivedZ04RequiredStartRejection,assertReceivedZ04RequiredStartActor} from '@/lib/ediel/prodat/receivedZ04RequiredStartRejection';
import {observeReceivedZ04RequiredStart} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator';
import {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry';
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator';
import {captureEdielTechnicalSyntaxAckEvidence,readEdielTechnicalSourceEndpoint,recordEdielTechnicalSyntaxDecision,technicalSyntaxAckQualification} from '@/lib/ediel/ack/technicalSyntaxAuthority';
import {createHash} from 'node:crypto';
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization';
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition';
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck';
import {prepareSourceAckDraft} from '@/lib/ediel/ack/prepareSourceAckDraft';
import {readRetainedProdatDocumentHold} from '@/lib/ediel/ack/retainedProdatDocumentHold';
import {readUnattributedTechnicalIntake} from '@/lib/ediel/inbound/receptions';
import {createReceivedErrApplicationAcks} from '@/lib/ediel/flows/receivedErrApplicationAcks';
import {loadCustomerLifeEventValidationContext} from '@/lib/ediel/production/lifeEventSource';
import {applyInboundCustomerLifeEvent} from '@/lib/ediel/flows/inboundCustomerLifeEvent';
import {applySupplyMarketSource} from '@/lib/ediel/flows/supplyMarketTransition';
import {projectSupplyEndFollowup} from '@/lib/ediel/flows/supplyEndFollowup';
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition';
import {publishSourceSwitchCommit} from '@/lib/ediel/flows/sourceSwitchCommit';
import {createReceivedProdatCommittedEffectAcks} from '@/lib/ediel/flows/receivedProdatStructuralAcks';
// lib/ediel/flows/inboundProcessing.ts
import {hasReceivedProdatHeaderRejection} from '@/lib/ediel/prodat/receivedProdatHeaderRejection';
import {isQualifiedProdatApplicationError} from "@/lib/ediel/prodat/prodatDiagnosticProjection";
import {prodatHeaderFieldRejection} from "@/lib/ediel/prodat/prodatHeaderDateRejection";
import {tokenizeEdifact} from "@/lib/ediel/core/edifactTokenizer";
import {prodatCharacteristicValues} from "@/lib/ediel/prodat/prodatCharacteristicFields";

import {
  createEdielMessageEvent,
  getEdielMessageById,
  getEdielRouteProfileByCommunicationRouteId,
  listEdielMessagesByIds,
} from "@/lib/ediel/db";
import type { EdielMessageRow } from "@/lib/ediel/types";
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  isActiveEdielMessageFamily,
} from "@/lib/ediel/types";
import { runInboundEdielMailEngine } from "@/lib/inbound-mail/edielMailboxPoller";
import { ensureActorUserId } from "@/lib/ediel/flows/shared";
import { formatErrorMessage } from "@/lib/errors";
import { createSupplierSwitchEvent } from "@/lib/operations/db";
import { supabaseService } from "@/lib/supabase/service";
import {
  findMatchingSupplierSwitchRequest,
  matchMeteringPointForEdielMessage,
  matchSiteAndCustomerForMeteringPoint,
} from "@/lib/ediel/matching";
import { linkEdielMessage, updateEdielMessageStatus } from "@/lib/ediel/db";
import {
  getAutomaticAckPolicy,
  type EdielAperakApplicationError,
} from "@/lib/ediel/ack";
import { createCanonicalAckMessage } from "@/lib/ediel/core/kernel";
import { processInboundUtiltsMessage } from "@/lib/ediel/flows/utiltsDataRequest";
import { processInboundAckMessage } from "@/lib/ediel/flows/inboundAckProcessing";
import { syncActorTestingForMessage } from "@/lib/ediel/actorTestingEngine";
import {
  resolveCanonicalRuntimeDecisionWithRegistry,
  hasReceivedCanonicalProdatPartialOwner,
  readReceivedCanonicalProdatApplicationObjects,
  type CanonicalRuntimeDecision,
  type CanonicalResponsePlanItem,
} from "@/lib/ediel/core/runtimeDecision";
import { buildSafeMasterdataProposal } from "@/lib/ediel/operationalVerification";
import { createOrUpdateInboundProdatCase } from "@/lib/ediel/inboundCases";
import {
  applyInboundProdatZ02ToCustomerInfoRequest,
  applyInboundProdatZ14ToMeteringPermission,
} from "@/lib/onboarding/inboundEdielLinking";
import { resolveInboundTenantForMessage } from "@/lib/ediel/core/tenantResolver";
import { analyzeEdielProcessingPipeline } from "@/lib/ediel/orchestrator/edielProcessingPipeline";
import { createOutboxItem } from "@/lib/ediel/outbox/createOutboxItem";
import { applyInboundBusinessStateMachine } from "@/lib/ediel/flows/inboundBusinessStateMachine";
import { processAiBiInboundReconciliation } from "@/lib/ediel/aiBiInboundReconciliation";

function shouldProcessInboundMessage(message: EdielMessageRow): boolean {
  return (
    message.direction === "inbound" &&
    message.message_standard === "edifact" &&
    message.status !== "cancelled"
  );
}

function hasInboundAckParties(message: EdielMessageRow): boolean {
  return Boolean(
    message.sender_ediel_id?.trim() && message.receiver_ediel_id?.trim(),
  );
}

function inboundActorRefusal(cause:unknown):EdielExecutionFailure {
  const failure=new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_INBOUND_EXECUTION_ACTOR_FORBIDDEN'},
    'ediel_inbound_execution_actor_forbidden');
  Object.defineProperty(failure,'cause',{value:cause,enumerable:false,writable:true,configurable:true});
  return failure;
}

function technicalActorRefusal(error:unknown):EdielExecutionFailure|null {
  if(error instanceof EdielExecutionFailure && error.disposition.kind==='security_quarantine')return error;
  // Technical RPC adapters retain trusted PostgREST errors in Error.cause.
  // Public payloads, message text and outer error labels are not authority.
  const seen=new Set<object>();let current=error;
  for(let depth=0;depth<8;depth++){
    if(!(current instanceof Error)||seen.has(current))return null;
    seen.add(current);
    const property=Object.getOwnPropertyDescriptor(current,'cause');
    const cause:unknown=property&&'value' in property?property.value:undefined;
    if(!cause||typeof cause!=='object'||seen.has(cause))return null;
    if(Object.getOwnPropertyDescriptor(cause,'code')?.value==='42501')return inboundActorRefusal(error);
    current=cause;
  }
  return null;
}

async function createAckBlockedEvent(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  ackFamily: "CONTRL" | "APERAK" | "UTILTS_ERR";
  reason: string;
  details?: Record<string, unknown>;
}) {
  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: "manual_note",
    eventStatus: "warning",
    message: `${params.ackFamily} skapades inte: ${params.reason}`,
    payload: {
      blockedBy: "canonical_inbound_ack_guard",
      ackFamily: params.ackFamily,
      sourceMessageId: params.sourceMessage.id,
      messageFamily: params.sourceMessage.message_family,
      messageCode: params.sourceMessage.message_code,
      status: params.sourceMessage.status,
      senderEdielId: params.sourceMessage.sender_ediel_id,
      receiverEdielId: params.sourceMessage.receiver_ediel_id,
      ...params.details,
    },
  });
}

async function createAckIfMissing(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  ackFamily: "CONTRL" | "APERAK" | "UTILTS_ERR";
  outcome?: "positive" | "negative";
  messageText?: string | null;
  applicationErrors?: readonly EdielAperakApplicationError[] | null;
  utiltsHeaderRejected?: boolean;
  relatedTransactionReference?:string;
  onProtectedExisting?:()=>void;
}) {
  const prepared=await prepareSourceAckDraft({actorUserId:params.actorUserId,sourceMessage:params.sourceMessage,
    ackFamily:params.ackFamily,outcome:params.outcome??(params.ackFamily==='UTILTS_ERR'?'negative':'positive'),
    messageText:params.messageText??null,applicationErrors:params.applicationErrors,
    utiltsHeaderRejected:params.utiltsHeaderRejected,relatedTransactionReference:params.relatedTransactionReference});
  // A protected immutable original is returned without outbox repair or a new
  // blocked-event audit. A separately authorized fresh repair has its own port.
  if(prepared.kind==='existing'){params.onProtectedExisting?.();return prepared.message;}
  const ack = await createCanonicalAckMessage({
    actorUserId: params.actorUserId,
    sourceMessage: params.sourceMessage,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
    draft:prepared.draft,
  });

  // Only a freshly prepared draft reaches this insertion-only queue branch.
  if (["draft", "prepared", "queued", "failed"].includes(String(ack.status))) {
    await createOutboxItem({
      actorUserId: params.actorUserId,
      message: ack,
      sourceMessageId: params.sourceMessage.id,
      status: "queued",
      queueOnlyIfInserted: true,
      payload: {
        createdBy: "inbound_backend_automation",
        ackFamily: params.ackFamily,
        outcome: params.outcome ?? null,
        sourceMessageId: params.sourceMessage.id,
        messageFamily: params.sourceMessage.message_family,
        messageCode: params.sourceMessage.message_code,
      },
    }).catch(async (error) => {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: params.ackFamily,
        reason: `outbox queue misslyckades: ${formatErrorMessage(error, "okänt fel")}`,
        details: { ackMessageId: ack.id },
      });
    });
  }

  return ack;
}

async function acknowledgeCommittedReceivedErr(actorUserId:string,message:EdielMessageRow){
  // The actual retained response owner decides replay versus a fresh prescribed
  // reply. Retained originals perform reads only; current-authority failures
  // propagate as holds without new blocked-event or outbox writes.
  await createReceivedErrApplicationAcks({actorUserId,message,createAck:scope=>createAckIfMissing({
    actorUserId,sourceMessage:scope.sourceMessage,ackFamily:'APERAK',outcome:'positive',
    relatedTransactionReference:scope.relatedTransactionReference}),repairRetainedAck:async()=>undefined});
}

async function readCanonicalAckSnapshot(source: EdielMessageRow, actorUserId: string) {
  const ackMessages = await listBusinessAckMessagesForSource({
    companyId: source.company_id, sourceMessageId: source.id, actorUserId, environment: source.environment,
  });

  return {
    // Incoming sources own generated originals, not an aggregate incoming-ACK
    // result. Public status caches cannot turn their existence into acceptance.
    canonicalAckState: ackMessages.length > 0 ? 'ack_originals_qualified' : 'ack_status_unproven',
    ackMessages: ackMessages.map((row) => ({
      id: row.id,
      family: row.message_family,
      code: row.message_code,
      status: row.status,
      outcome: row.ack_outcome,
    })),
  };
}

function isActorTestingInboundCandidate(message: EdielMessageRow): boolean {
  const parsed = message.parsed_payload ?? {};
  const report = message.validation_report ?? {};
  const fileEngine = parsed.fileEngine as { mode?: unknown } | undefined;
  const systemTest = parsed.systemTest as { suite?: unknown } | undefined;

  return (
    message.direction === "inbound" &&
    message.environment === "test" &&
    (fileEngine?.mode === "agt" ||
      report.fileEngineMode === "agt" ||
      String(systemTest?.suite ?? "").toUpperCase() === "AGT")
  );
}

async function syncActorTestingGlobally(params: {
  actorUserId: string;
  message: EdielMessageRow;
  phase:
    | "pre_business_processing"
    | "post_ack_processing"
    | "post_generic_processing";
  autoRespond?: boolean;
  autoSend?: boolean;
}): Promise<boolean> {
  if (!isActorTestingInboundCandidate(params.message)) return false;

  try {
    const synced = await syncActorTestingForMessage({
      actorUserId: params.actorUserId,
      edielMessage: params.message,
      autoRespond: params.autoRespond,
      autoSend: params.autoSend,
    });

    if (!synced) return false;

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: "linked",
      eventStatus: "success",
      message:
        "Meddelandet synkades automatiskt till Aktörstest & Produktionssättning.",
      payload: {
        actorTestingGlobalHook: true,
        phase: params.phase,
        companyId: synced.companyId,
        testKey: synced.testKey,
        status: synced.status,
        createdAckMessageIds: synced.createdAckMessages.map(
          (message) => message.id,
        ),
      },
    });

    return true;
  } catch (error) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Aktörstest-synk kunde inte köras automatiskt för inbound-meddelandet.",
      payload: {
        actorTestingGlobalHook: true,
        phase: params.phase,
        error: formatErrorMessage(error, "Aktörstest-synk misslyckades."),
      },
    }).catch(() => null);

    return false;
  }
}

function canonicalResponsePlanFromMessage(
  message: EdielMessageRow,
): CanonicalResponsePlanItem[] {
  const report = message.validation_report ?? {};
  const direct = report.responsePlan;
  const nested = (
    report.canonicalRuntime as { responsePlan?: unknown } | undefined
  )?.responsePlan;
  const candidate = Array.isArray(direct)
    ? direct
    : Array.isArray(nested)
      ? nested
      : [];
  return candidate.filter((item): item is CanonicalResponsePlanItem => {
    if (!item || typeof item !== "object") return false;
    const family = (item as { family?: unknown }).family;
    return (
      family === "CONTRL" || family === "APERAK" || family === "UTILTS_ERR"
    );
  });
}

function prodatInternalReview(message: EdielMessageRow): boolean {
  const disposition = message.validation_report?.prodatProcessingDisposition as {kind?: unknown} | undefined;
  return message.message_family === "PRODAT" && disposition?.kind === "internal_review";
}

function responsePlanItemFor(
  message: EdielMessageRow,
  family: "CONTRL" | "APERAK" | "UTILTS_ERR",
): CanonicalResponsePlanItem | null {
  return (
    canonicalResponsePlanFromMessage(message).find(
      (item) => item.family === family,
    ) ?? null
  );
}

async function applyCanonicalRuntimeDecision(params: {
  actorUserId: string;
  message: EdielMessageRow;
  originalMessage: EdielMessageRow;
  resolvedCompanyId: string;
}): Promise<{ message: EdielMessageRow; decision: CanonicalRuntimeDecision; sourceOwnerSession: SourceOwnerSession | null; lifeEventSourceReadFailure:string|null; authorizedPartialOwner:boolean; domainObjectCount:number }> {
  const syntax=params.message.message_standard==='edifact'
    ? validateEdifactSyntax({...params.message,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}) : null;
  let deathStatusContext:Awaited<ReturnType<typeof loadCustomerLifeEventValidationContext>>;
  let lifeEventSourceReadFailure:string|null=null;
  if(syntax?.ok){
    try{deathStatusContext=await loadCustomerLifeEventValidationContext(params.message,params.actorUserId)}
    catch(error){lifeEventSourceReadFailure=formatErrorMessage(error,'Kundhändelsens skyddade källa kunde inte läsas.')}
  }
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(params.message,{deathStatusContext,actorUserId:params.actorUserId});
  // Only the opaque result of this exact rule invocation may keep independent
  // good own scopes moving past a sibling's internal hold. Public JSON cannot.
  const authorizedPartialOwner=hasReceivedCanonicalProdatPartialOwner(decision,params.message);
  // This exact invocation's complete own APP is only a continuation signal.
  // The native domain owner still checks global FUNCTION and actual business
  // originals/relations for every own object before any effect or receipt.
  const ownApplication=readReceivedCanonicalProdatApplicationObjects(decision,params.message);
  const domainObjectCount=params.message.message_family==='PRODAT'&&['Z04','Z05','Z14','Z15'].includes(params.message.message_code)
    &&decision.syntaxDecision==='accepted'&&decision.functionalDecision==='accepted'
    &&ownApplication?.headerDecision==='accepted'
    &&ownApplication.objects.some(object=>object.applicationDecision==='accepted'&&object.reasonCodes.length===0)
      ?ownApplication.objects.length:0;
  const sourceValidationEvidence = await recordReceivedSourceValidation({
    original: params.originalMessage, validated: params.message, resolvedCompanyId: params.resolvedCompanyId, decision,
  });
  const registryIncidentReview = decision.prodatProcessingDisposition?.kind==='internal_review' &&
    receivedOriginalRulePackWitness(decision.validationReport.rulePackEvidence)===null;
  const protectedPhysicalRejection=hasReceivedZ04RequiredStartRejection(decision,params.message,params.actorUserId)
    ||hasReceivedZ04HRegisterRejection(decision,params.message,params.actorUserId)
    ||hasReceivedZ04HRequiredFieldRejection(decision,params.message,params.actorUserId)
    ||hasReceivedZ04HStructuralFieldRejection(decision,params.message,params.actorUserId);
  if(params.message.message_family==='PRODAT' && decision.syntaxDecision==='accepted' && (decision.policy||protectedPhysicalRejection) && !registryIncidentReview) {
    if(sourceValidationEvidence.status!=='recorded')throw new Error('prodat_canonical_source_validation_unconfirmed');
    await captureFreshEdielSourceRulePackEvidence(params.resolvedCompanyId,params.message.id);
  }
  const sourceOwnerSession = protectedPhysicalRejection||hasReceivedProdatHeaderRejection(decision,params.message,params.actorUserId)
    ?null:createReceivedSourceOwnerSession(sourceValidationEvidence);
  const now = new Date().toISOString();
  const parsedPayloadBeforeRuntime = params.message.parsed_payload ?? {};
  const validationReportBeforeRuntime = params.message.validation_report ?? {};
  const persistedTenantResolution =
    parsedPayloadBeforeRuntime.tenantResolution ??
    validationReportBeforeRuntime.tenantResolution ??
    null;
  const mergedParsedPayload = {
    ...parsedPayloadBeforeRuntime,
    canonical: decision.parsedPayload,
    ...(persistedTenantResolution ? { tenantResolution: persistedTenantResolution } : {}),
  };
  const mergedValidationReport = {
    ...validationReportBeforeRuntime,
    ...(persistedTenantResolution ? { tenantResolution: persistedTenantResolution } : {}),
    canonicalRuntime: decision.validationReport,
    ...(sourceValidationEvidence.status !== "not_requested" ? { receivedSourceValidationEvidence: sourceValidationEvidence } : {}),
    canonicalRuntimeVersion: "2.5B",
    syntaxDecision: decision.syntaxDecision,
    applicationDecision: decision.applicationDecision,
    functionalDecision: decision.functionalDecision,
    responsePlan: decision.responsePlan,
    prodatProcessingDisposition: decision.prodatProcessingDisposition,
    decisionTrace: decision.decisionTrace,
    sourceRules: decision.sourceRules,
    runtimeTenantResolutionSource: persistedTenantResolution ? "persisted" : "not_available",
    ...(lifeEventSourceReadFailure?{customerLifeEventSourceIncident:{kind:'source_read_unavailable',reason:lifeEventSourceReadFailure,authorizesBusinessEffects:false}}:{}),
  };

  const nextStatus =
    decision.syntaxDecision === "rejected" ? "failed" : "validated";
  const failureReason =
    decision.syntaxDecision === "rejected"
      ? decision.issues
          .filter(
            (item) => item.layer === "syntax" && item.severity === "error",
          )
          .map((item) => item.description)
          .join(" | ") || "EDIFACT syntaxfel."
      : undefined;

  const updated = await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    status: nextStatus,
    parsedPayload: mergedParsedPayload,
    validationReport: mergedValidationReport,
    parsedAt: params.message.parsed_at ?? now,
    validatedAt: now,
    failedAt: nextStatus === "failed" ? now : undefined,
    failureReason,
  });

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: "validated",
    eventStatus:
      decision.syntaxDecision === "rejected" ||
      decision.applicationDecision === "rejected" ||
      decision.functionalDecision === "rejected" ||
      decision.prodatProcessingDisposition?.kind === "internal_review"
        ? "warning"
        : "success",
    message: "Canonical Ediel Runtime Engine kördes för inbound-meddelandet.",
    payload: {
      batch: "2.5B",
      family: decision.canonical.family,
      messageCode: decision.canonical.messageCode,
      processGroup: decision.canonical.processGroup,
      syntaxDecision: decision.syntaxDecision,
      applicationDecision: decision.applicationDecision,
      functionalDecision: decision.functionalDecision,
      responsePlan: decision.responsePlan,
      issueCount: decision.issues.length,
      prodatProcessingDisposition: decision.prodatProcessingDisposition,
      sourceRules: decision.sourceRules,
      decisionTrace: decision.decisionTrace,
      tenantResolution: persistedTenantResolution,
      runtimeTenantResolutionSource: persistedTenantResolution ? "persisted" : "not_available",
    },
  });

  return { message: updated, decision, sourceOwnerSession,lifeEventSourceReadFailure,authorizedPartialOwner,domainObjectCount };
}


async function recordBackendAutomationPipelineTrace(params: {
  actorUserId: string;
  message: EdielMessageRow;
}) {
  try {
    await analyzeEdielProcessingPipeline({
      actorUserId: params.actorUserId,
      message: params.message,
      createSlaTimers: true,
      createDecisionTrace: true,
    });
  } catch (error) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Backend automation pipeline trace kunde inte sparas. Inboundflödet fortsätter med befintlig runtime-logik.",
      payload: {
        automationPipeline: "trace_failed_non_blocking",
        error: formatErrorMessage(error, "Automation pipeline trace misslyckades."),
      },
    }).catch(() => null);
  }
}

async function createAutomaticPositiveAcks(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  deferProdatPositive?:boolean;
}) {
  const createdIds: string[] = [];
  // A bilateral capability that is no longer current, or a source missing
  // the physical process reference, leaves no qualified policy. Retain the
  // source for review without manufacturing a guide, ACK or domain effect.
  let policy: Awaited<ReturnType<typeof getAutomaticAckPolicy>>;
  try{policy = await getAutomaticAckPolicy(params.sourceMessage);}
  catch(error){
    const code=error instanceof Error?error.message:'';
    const wire=params.sourceMessage.message_family==='PRODAT'&&params.sourceMessage.direction==='inbound'&&params.sourceMessage.raw_payload
      ?tokenizeEdifact(params.sourceMessage.raw_payload):null;
    const missingSubtype=code==='prodat_subtype_unknown:missing'&&wire!==null&&prodatCharacteristicValues('223',wire.segments,wire.una).length===0;
    if(!missingSubtype&&!/^(?:prodat_bilateral_capability_required:|canonical_ediel_application_reference_required:PRODAT:)/.test(code))throw error;
    await createAckBlockedEvent({actorUserId:params.actorUserId,sourceMessage:params.sourceMessage,ackFamily:"APERAK",
      reason:formatErrorMessage(error,"Källbunden kvittenspolicy saknas.")});
    return createdIds;
  }

  if (
    (policy.shouldSendContrl || policy.shouldSendPositiveAperak) &&
    !hasInboundAckParties(params.sourceMessage)
  ) {
    await createAckBlockedEvent({
      actorUserId: params.actorUserId,
      sourceMessage: params.sourceMessage,
      ackFamily: policy.shouldSendContrl ? "CONTRL" : "APERAK",
      reason:
        "inbound sender/receiver saknas. Meddelandet kvitteras inte automatiskt.",
      details: {
        shouldSendContrl: policy.shouldSendContrl,
        shouldSendPositiveAperak: policy.shouldSendPositiveAperak,
      },
    });
    return createdIds;
  }

  const contrlPlan = responsePlanItemFor(params.sourceMessage, "CONTRL");
  if (policy.shouldSendContrl || contrlPlan) {
    try {
      const contrl = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: "CONTRL",
        outcome: contrlPlan?.outcome === "negative" ? "negative" : "positive",
        messageText: contrlPlan?.reason ?? "Automatiskt CONTRL.",
      });
      createdIds.push(contrl.id);
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: "CONTRL",
        reason:
          error instanceof Error
            ? error.message
            : "Okänt fel vid CONTRL-skapande.",
      });
    }
  }

  const utiltsErrPlan = responsePlanItemFor(params.sourceMessage, "UTILTS_ERR");
  if (utiltsErrPlan) {
    try {
      const utiltsErr = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: "UTILTS_ERR",
        outcome: "negative",
        messageText: utiltsErrPlan.reason,
      });
      createdIds.push(utiltsErr.id);
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: "UTILTS_ERR",
        reason:
          error instanceof Error
            ? error.message
            : "Okänt fel vid UTILTS_ERR-skapande.",
      });
    }

    return createdIds;
  }

  const aperakPlan = responsePlanItemFor(params.sourceMessage, "APERAK");
  const shouldSendAperakFromPlan = Boolean(
    aperakPlan?.outcome &&
      (aperakPlan.outcome === "negative" ||
        params.sourceMessage.requires_aperak ||
        params.sourceMessage.message_family === "PRODAT" ||
        params.sourceMessage.message_family === "UTILTS"),
  );
  const internalReview = prodatInternalReview(params.sourceMessage);
  const deferPositive=params.deferProdatPositive===true||params.sourceMessage.message_family==='PRODAT'
    &&['Z04','Z05','Z14','Z15'].includes(params.sourceMessage.message_code);
  const applicationErrors = internalReview||deferPositive
    ? aperakPlan?.applicationErrors?.filter(isQualifiedProdatApplicationError)
    : aperakPlan?.applicationErrors;
  if ((policy.shouldSendPositiveAperak || shouldSendAperakFromPlan) &&
      (!(internalReview||deferPositive) || aperakPlan?.outcome === "negative" && Boolean(applicationErrors?.length))) {
    try {
      const aperak = await createAckIfMissing({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: "APERAK",
        outcome: aperakPlan?.outcome === "negative" ? "negative" : "positive",
        messageText: aperakPlan?.reason ?? "Automatiskt APERAK.",
        applicationErrors: applicationErrors ?? null,
        utiltsHeaderRejected: aperakPlan?.utiltsHeaderRejected,
      });
      createdIds.push(aperak.id);
    } catch (error) {
      await createAckBlockedEvent({
        actorUserId: params.actorUserId,
        sourceMessage: params.sourceMessage,
        ackFamily: "APERAK",
        reason: formatErrorMessage(error, "Okänt fel vid APERAK-skapande."),
      });
    }
  }

  return createdIds;
}

/** A final positive response is projected only from the real committed own
 * domain receipt. A held response cannot reinterpret a completed business TX. */
async function createCommittedDomainAcks(actorUserId:string,message:EdielMessageRow):Promise<string[]>{
  if(!message.company_id)return[];
  try{return await createReceivedProdatCommittedEffectAcks({actorUserId,companyId:message.company_id,sourceMessageId:message.id,
    ownNegativeErrors:canonicalResponsePlanFromMessage(message).find(plan=>plan.family==='APERAK'&&plan.outcome==='negative')?.applicationErrors?.filter(isQualifiedProdatApplicationError)})}
  catch(error){
    await createAckBlockedEvent({actorUserId,sourceMessage:message,ackFamily:'APERAK',
      reason:formatErrorMessage(error,'Egna positiva svar inväntar beständiga skrivkvitton.')});
    return[];
  }
}

async function linkInboundProdatMessageCanonically(params: {
  actorUserId: string;
  message: EdielMessageRow;
}) {
  const meteringPointId = await matchMeteringPointForEdielMessage(
    params.message,
  );
  const siteAndCustomer = await matchSiteAndCustomerForMeteringPoint({
    meteringPointId,
    companyId: params.message.company_id ?? null,
  });
  const matchedSwitch = await findMatchingSupplierSwitchRequest(params.message);

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    switchRequestId: matchedSwitch?.id ?? null,
    customerId: siteAndCustomer?.customerId ?? null,
    siteId: siteAndCustomer?.siteId ?? null,
    meteringPointId,
    gridOwnerId: siteAndCustomer?.gridOwnerId ?? null,
    relatedMessageId: null,
  });

  return {
    meteringPointId,
    siteAndCustomer,
    matchedSwitch,
  };
}

async function processInboundProdatMessage(params: {
  actorUserId: string;
  message: EdielMessageRow;
  onSourceSwitchCommitted?: SourceSwitchCommitObserver;
  committedSupplyResult?: Awaited<ReturnType<typeof applySupplyMarketSource>>;
}) {
  const canonicalLinks = await linkInboundProdatMessageCanonically({
    actorUserId: params.actorUserId,
    message: params.message,
  });

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    status: "parsed",
    parsedPayload: params.message.parsed_payload ?? {},
  });

  const inboundCase = await createOrUpdateInboundProdatCase({
    actorUserId: params.actorUserId,
    message: params.message,
  });

  const customerInfoLink = await applyInboundProdatZ02ToCustomerInfoRequest({
    actorUserId: params.actorUserId,
    message: params.message,
  });

  const meteringPermissionLink =
    await applyInboundProdatZ14ToMeteringPermission({
      actorUserId: params.actorUserId,
      message: params.message,
    });

  if (!canonicalLinks.matchedSwitch) {
    const businessState = await applyInboundBusinessStateMachine({
      actorUserId: params.actorUserId,
      message: params.message,
      customerInfoRequestId:
        (customerInfoLink as { customerInfoRequestId?: string | null } | null)?.customerInfoRequestId ??
        (customerInfoLink as { requestId?: string | null } | null)?.requestId ??
        null,
      permissionSourceResult: meteringPermissionLink,
      source: "prodat_without_strong_switch_match",
      committedSupplyResult: params.committedSupplyResult,
      onSourceSwitchCommitted: params.onSourceSwitchCommitted,
    });

    const safeApplyProposalChanges = ["Z06", "Z10"].includes(
      String(params.message.message_code),
    )
      ? await buildSafeMasterdataProposal(params.message)
      : [];

    if (safeApplyProposalChanges.length > 0) {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.message.id,
        eventType: "manual_note",
        eventStatus: "warning",
        message:
          "Safe apply-förslag skapades för Z06/Z10 utan stark switch-koppling. Masterdata skrevs inte över automatiskt.",
        payload: {
          batch: "6B",
          safeApply: true,
          appliedAutomatically: false,
          proposedChanges: safeApplyProposalChanges,
          reviewRequired: true,
          inboundCaseId: inboundCase?.id ?? null,
          customerInfoRequestLink: customerInfoLink,
          meteringPermissionLink,
        },
      });
    }

    const ackIds = await createAutomaticPositiveAcks({
      actorUserId: params.actorUserId,
      sourceMessage: params.message,
    });
    const ackSnapshot = await readCanonicalAckSnapshot(params.message, params.actorUserId);

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: "validated",
      eventStatus: "warning",
      message:
        "Inbound PRODAT kvitterades automatiskt och lades i admin-godkännande eftersom stark switch-koppling saknas.",
      payload: {
        createdAckMessageIds: ackIds,
        canonicalAckState: ackSnapshot.canonicalAckState,
        ackMessages: ackSnapshot.ackMessages,
        safeApplyProposalChanges,
        inboundCaseId: inboundCase?.id ?? null,
        customerInfoRequestLink: customerInfoLink,
        meteringPermissionLink,
        businessState,
      },
    });

    return;
  }

  // Switch status transitions for inbound PRODAT have exactly ONE writer:
  // applyInboundBusinessStateMachine below. The previous inline Z04/Z05
  // updates here duplicated the write and wrongly completed switches on Z05.
  const businessState = await applyInboundBusinessStateMachine({
    actorUserId: params.actorUserId,
    message: params.message,
    matchedSwitchRequestId: canonicalLinks.matchedSwitch.id,
    customerInfoRequestId:
      (customerInfoLink as { customerInfoRequestId?: string | null } | null)?.customerInfoRequestId ??
      (customerInfoLink as { requestId?: string | null } | null)?.requestId ??
      null,
    permissionSourceResult: meteringPermissionLink,
    source: "prodat_with_strong_switch_match",
    committedSupplyResult: params.committedSupplyResult,
      onSourceSwitchCommitted: params.onSourceSwitchCommitted,
  });

  const safeApplyProposalChanges = ["Z06", "Z10"].includes(
    String(params.message.message_code),
  )
    ? await buildSafeMasterdataProposal(params.message)
    : [];

  if (safeApplyProposalChanges.length > 0) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Safe apply-förslag skapades för Z06/Z10. Masterdata skrevs inte över automatiskt.",
      payload: {
        batch: "6B",
        safeApply: true,
        appliedAutomatically: false,
        proposedChanges: safeApplyProposalChanges,
        reviewRequired: true,
        inboundCaseId: inboundCase?.id ?? null,
        customerInfoRequestLink: customerInfoLink,
        meteringPermissionLink,
        businessState,
      },
    });
  }

  const ackIds = await createAutomaticPositiveAcks({
    actorUserId: params.actorUserId,
    sourceMessage: params.message,
  });
  const ackSnapshot = await readCanonicalAckSnapshot(params.message, params.actorUserId);

  await createSupplierSwitchEvent(supabaseService, {
    switchRequestId: canonicalLinks.matchedSwitch.id,
    eventType: "ediel_inbound_processed",
    eventStatus: "success",
    message:
      "Inbound PRODAT behandlad via canonical inbound flow och staging-case skapades för eventuell admin-granskning.",
    payload: {
      edielMessageId: params.message.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
      safeApplyProposalChanges,
      inboundCaseId: inboundCase?.id ?? null,
      customerInfoRequestLink: customerInfoLink,
      meteringPermissionLink,
      businessState,
    },
  });

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: "validated",
    eventStatus: "success",
    message:
      "Inbound PRODAT processad via canonical inbound flow och staging-case skapat.",
    payload: {
      matchedSwitchRequestId: canonicalLinks.matchedSwitch.id,
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
      safeApplyProposalChanges,
      inboundCaseId: inboundCase?.id ?? null,
      businessState,
    },
  });
}

export async function processInboundEdielMessage(params: {
  actorUserId: string;
  edielMessageId: string;
}) {
  const actorUserId = ensureActorUserId(params.actorUserId);
  const message = await getEdielMessageById(params.edielMessageId);

  if (!message) throw new Error("Ediel-meddelandet hittades inte");

  // The private born disposition is permanent and precedes any legal patch.
  // Its read failure cannot be treated as an ordinary source or an ACK basis.
  const protectedIntake = message.direction==='inbound' && message.company_id===null
    && message.message_standard==='edifact' && ['PRODAT','UTILTS'].includes(message.message_family)
    ? await readUnattributedTechnicalIntake({actorUserId,sourceMessageId:message.id,
      sourcePayloadHash:createHash('sha256').update(message.raw_payload ?? '', 'utf8').digest('hex'),environment:message.environment})
    : null;

  if(message.direction==='inbound' && ['CONTRL','APERAK','UTILTS_ERR'].includes(message.message_family)){
    // A protected old own receipt is read before current route/guide/runtime
    // loaders and public projection writes. Legacy summaries stay unknown.
    const committed=await readCommittedInboundAck({actorUserId,message});
    if(committed){
      if(message.message_family==='UTILTS_ERR')await acknowledgeCommittedReceivedErr(actorUserId,message);
      return message;
    }
  }

  if (message.direction === 'inbound' && (message.message_standard === 'ai_list' || message.message_family === 'AI_LIST')) {
    await processAiBiInboundReconciliation({ actorUserId, message });
    return message;
  }

  if (!shouldProcessInboundMessage(message)) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Batch 6 hoppade över meddelandet eftersom det inte är inbound EDIFACT i aktivt flöde.",
      payload: {
        direction: message.direction,
        standard: message.message_standard,
      },
    });
    return message;
  }

  // An unknown physical directory is held before any technical receipt or
  // tenant/runtime attribution, including when no technical endpoint exists.
  const selectedSyntax=validateEdifactSyntax({...message,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null});
  if(selectedSyntax.grammarQualification==='unavailable') {
    await createEdielMessageEvent({actorUserId,edielMessageId:message.id,eventType:'manual_note',eventStatus:'warning',
      message:'Selected UNSM-directory saknar kvalificerad full källgrammatik; inbound hålls före kvittens och affärseffekter.',
      payload:{reason:'ediel_unsm_directory_source_unavailable',issues:selectedSyntax.issues}});
    return message;
  }

  // Syntax belongs to the actual wire and transport endpoint. It precedes
  // legal tenant routing and grants no business attribution or guide approval.
  let acceptedTechnicalAcknowledgementCompanyId: string | null = null;
  let retainedAcceptedTechnicalAcknowledgement = false;
  // A grammar-qualified physical A210 refusal must precede even diagnostic
  // tenant writes. NULL technical endpoints remain lawful for other sources;
  // this current actor READ grants no response or business capability.
  if(selectedSyntax.ok&&message.message_family==='PRODAT'&&message.message_code==='Z04'&&message.company_id&&message.raw_payload){
    const wire=tokenizeEdifact(message.raw_payload);
    if(observeReceivedZ04RequiredStart({rawSegments:wire.segments.map(row=>row.raw),una:wire.una}).length
      &&!await assertReceivedZ04RequiredStartActor(message,actorUserId))return message;
  }
  if(message.message_family!=='CONTRL') {
    try {
      const endpoint=await readEdielTechnicalSourceEndpoint(message.id,{actorUserId,phase:'prepare'});
      if(endpoint) {
        if(endpoint.environment!==message.environment || endpoint.sourceHash!==createHash('sha256').update(message.raw_payload ?? '', 'utf8').digest('hex'))throw new Error('technical_source_wire_scope_mismatch');
        try {
          await assertEdielTenantActor({companyId:endpoint.companyId,actorUserId,permission:'communication.write'});
        } catch(error) {
          if(error instanceof EdielExecutionFailure && error.disposition.kind==='security_quarantine')throw error;
          // A direct PostgREST permission error is trusted only at this actual
          // actor-check stage; keep every other actor/read error unchanged.
          if(error&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='42501')throw inboundActorRefusal(error);
          throw error;
        }
        const syntax=selectedSyntax;
        await recordEdielTechnicalSyntaxDecision({companyId:endpoint.companyId,sourceMessageId:message.id,sourceHash:endpoint.sourceHash,
          syntaxDecision:syntax.ok?'accepted':'rejected',reasonCodes:syntax.issues.filter(issue=>issue.severity==='error').map(issue=>issue.code),execution:{actorUserId,phase:'prepare'}});
        const capturedSyntax=await captureEdielTechnicalSyntaxAckEvidence(endpoint.companyId,message.id,{actorUserId,phase:'prepare'});
        let protectedExistingTechnicalAck=false;
        const technicalAck=await createAckIfMissing({actorUserId,sourceMessage:message,ackFamily:'CONTRL',outcome:syntax.ok?'positive':'negative',
          onProtectedExisting:()=>{protectedExistingTechnicalAck=true;}});
        const qualifiedSyntax=technicalSyntaxAckQualification({evidence:capturedSyntax,companyId:endpoint.companyId,
          environment:endpoint.environment,sourceMessageId:message.id});
        // Automatic test communication needs both the protected syntax owner
        // and the actual freshly persisted or protected retained CONTRL. This
        // local result never authorizes the separate business-source owner.
        if(syntax.ok && qualifiedSyntax?.syntaxDecision==='accepted' && qualifiedSyntax.sourceHash===endpoint.sourceHash
          && technicalAck.company_id===endpoint.companyId && technicalAck.environment===endpoint.environment
          && technicalAck.direction==='outbound' && technicalAck.message_family==='CONTRL'
          && technicalAck.related_message_id===message.id && typeof technicalAck.raw_payload==='string' && technicalAck.raw_payload.length>0) {
          acceptedTechnicalAcknowledgementCompanyId=endpoint.companyId;
          retainedAcceptedTechnicalAcknowledgement=protectedExistingTechnicalAck;
        }
      }
    } catch(error) {
      const securityRefusal=technicalActorRefusal(error);
      if(securityRefusal)throw securityRefusal;
      await createAckBlockedEvent({actorUserId,sourceMessage:message,ackFamily:'CONTRL',
        reason:formatErrorMessage(error,'Teknisk kvittens kunde inte kvalificeras.')});
    }
  }

  // Only this invocation's protected existing CONTRL read selects replay. A
  // freshly created first reply keeps the ordinary tenant/validation path.
  // Actor/source refusals propagate outside the technical diagnostic catch.
  if(retainedAcceptedTechnicalAcknowledgement
    &&await readRetainedProdatDocumentHold({actorUserId,sourceMessage:message,syntax:selectedSyntax}))return message;

  if(protectedIntake) {
    await createEdielMessageEvent({actorUserId,edielMessageId:message.id,eventType:'manual_note',eventStatus:'warning',
      message:'Tekniskt original behålls i skyddad staging utan juridisk tenant eller affärseffekt.',
      payload:{disposition:protectedIntake.disposition,authorizesBusinessEffect:false}});
    return message;
  }

  if (!isActiveEdielMessageFamily(message.message_family)) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Batch 6 hoppade över meddelandet eftersom familjen ligger utanför aktiv release.",
      payload: {
        messageFamily: message.message_family,
        activeFamilies: ACTIVE_EDIEL_MESSAGE_FAMILIES,
      },
    });
    return message;
  }

  const tenantResolution = await resolveInboundTenantForMessage({
    actorUserId,
    message,
  });
  const tenantResolvedMessage = tenantResolution.message;

  if (tenantResolution.status !== "tenant_resolved") {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: tenantResolvedMessage.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Inbound Ediel processing stopped before runtime/business matching because tenant routing is unresolved. No negative CONTRL is created for this routing issue.",
      payload: {
        tenantResolutionStatus: tenantResolution.status,
        evidence: tenantResolution.evidence,
        ackDecision: "no_negative_contrl_for_routing_unresolved",
      },
    });
    return tenantResolvedMessage;
  }

  const canonicalRuntime = await applyCanonicalRuntimeDecision({
    actorUserId,
    message: tenantResolvedMessage,
    originalMessage: message,
    resolvedCompanyId: tenantResolution.companyId,
  });
  const runtimeMessage = canonicalRuntime.message;

  // Only this same-invocation negative owner may precede the unavailable
  // bilateral automatic policy. Real canonical capture above and the normal
  // protected negative ACK gateway remain mandatory; no business path follows.
  if(hasReceivedProdatHeaderRejection(canonicalRuntime.decision,tenantResolvedMessage,actorUserId)
    ||hasReceivedZ04RequiredStartRejection(canonicalRuntime.decision,tenantResolvedMessage,actorUserId)
    ||hasReceivedZ04HRegisterRejection(canonicalRuntime.decision,tenantResolvedMessage,actorUserId)
    ||hasReceivedZ04HRequiredFieldRejection(canonicalRuntime.decision,tenantResolvedMessage,actorUserId)
    ||hasReceivedZ04HStructuralFieldRejection(canonicalRuntime.decision,tenantResolvedMessage,actorUserId)){
    const plan=canonicalRuntime.decision.responsePlan.find(plan=>plan.family==='APERAK'&&plan.outcome==='negative');
    if(!plan?.applicationErrors?.length)throw new Error('prodat_required_start_negative_owner_unavailable');
    await createAckIfMissing({actorUserId,sourceMessage:runtimeMessage,ackFamily:'APERAK',outcome:'negative',
      messageText:plan.reason,applicationErrors:plan.applicationErrors});
    return runtimeMessage;
  }

  await recordBackendAutomationPipelineTrace({
    actorUserId,
    message: runtimeMessage,
  });

  if (canonicalRuntime.decision.syntaxDecision === "rejected") {
    await canonicalRuntime.sourceOwnerSession?.finish();
    await createAutomaticPositiveAcks({
      actorUserId,
      sourceMessage: runtimeMessage,
    });
    return runtimeMessage;
  }

  // A genuinely missing subtype has no business policy or source-rule basis.
  // Stop before legacy projections and business ACK readers; the independently
  // qualified technical CONTRL above remains a response to the actual syntax.
  const missing223=runtimeMessage.message_family==='PRODAT' && runtimeMessage.direction==='inbound'
    && runtimeMessage.raw_payload && canonicalRuntime.decision.policy===null
    && canonicalRuntime.decision.syntaxDecision==='accepted'
    && canonicalRuntime.decision.applicationDecision==='rejected'
    && canonicalRuntime.decision.functionalDecision==='not_applicable'
    && !canonicalRuntime.authorizedPartialOwner && canonicalRuntime.domainObjectCount===0
    && canonicalRuntime.decision.issues.some(issue=>issue.code==='CANONICAL_POLICY_RESOLUTION_FAILED')
    && canonicalRuntime.decision.issues.some(issue=>issue.code==='PRODAT_TRANSACTION_REASON_INVALID'
      && issue.prodatDiagnostic?.kind==='field' && issue.prodatDiagnostic.fieldNumber==='223'
      && issue.prodatDiagnostic.errorKind==='missing');
  if(missing223){
    const wire=tokenizeEdifact(runtimeMessage.raw_payload!);
    if(prodatCharacteristicValues('223',wire.segments,wire.una).length===0){
      try{
        await createAckBlockedEvent({actorUserId,sourceMessage:runtimeMessage,ackFamily:'APERAK',
          reason:'prodat_subtype_unknown:missing; fysisk undertyp saknas och ingen källbunden applikationspolicy kan väljas.'});
      }finally{await canonicalRuntime.sourceOwnerSession?.finish();}
      return runtimeMessage;
    }
  }

  // Missing/unlisted BGM/C002/1001 is checked against the physical header
  // before code-specific policy exists. A typed field 202 finding can qualify
  // the draft; the canonical ACK gateway still requires the persisted code
  // to own the physical source before either response is written.
  const unresolved202Wire=runtimeMessage.message_family === "PRODAT" && runtimeMessage.raw_payload &&
    canonicalRuntime.decision.applicationDecision === "rejected" && !canonicalRuntime.decision.policy
      ? tokenizeEdifact(runtimeMessage.raw_payload) : null;
  const unresolved202=unresolved202Wire
    ? prodatHeaderFieldRejection({field:'202',sourceWire:unresolved202Wire,errors:[]}) : null;
  if (runtimeMessage.message_family === "PRODAT" && unresolved202?.defect &&
      canonicalRuntime.decision.applicationDecision === "rejected" &&
      !canonicalRuntime.decision.policy) {
    const plan=canonicalRuntime.decision.responsePlan.find(item=>item.family==="APERAK"&&item.outcome==="negative");
    const field202=prodatHeaderFieldRejection({field:'202',sourceWire:unresolved202Wire,errors:plan?.applicationErrors});
    try {
      try {
        await createAckIfMissing({actorUserId, sourceMessage:runtimeMessage, ackFamily:"CONTRL", outcome:"positive"});
      } catch (error) {
        await createAckBlockedEvent({actorUserId,sourceMessage:runtimeMessage,ackFamily:"CONTRL",
          reason:formatErrorMessage(error,"Teknisk kvittens kunde inte kvalificeras.")});
      }
      if (field202.qualified && plan?.applicationErrors?.length) {
        try {
          await createAckIfMissing({actorUserId,sourceMessage:runtimeMessage,ackFamily:"APERAK",outcome:"negative",
            messageText:plan.reason,applicationErrors:plan.applicationErrors});
        } catch (error) {
          await createAckBlockedEvent({actorUserId,sourceMessage:runtimeMessage,ackFamily:"APERAK",
            reason:formatErrorMessage(error,"Källbunden APERAK kunde inte kvalificeras.")});
        }
      } else {
        await createAckBlockedEvent({actorUserId,sourceMessage:runtimeMessage,ackFamily:"APERAK",
          reason:"PRODAT-policy och källbunden applikationsdiagnos saknas; negativ APERAK kräver kvalificerad orsak."});
      }
    } finally {
      await canonicalRuntime.sourceOwnerSession?.finish();
    }
    return runtimeMessage;
  }

  if (prodatInternalReview(runtimeMessage) && !canonicalRuntime.authorizedPartialOwner && !canonicalRuntime.domainObjectCount) {
    await canonicalRuntime.sourceOwnerSession?.finish();
    await createAutomaticPositiveAcks({actorUserId, sourceMessage: runtimeMessage});
    return runtimeMessage;
  }

  // Source-owned header defects reject the whole message. Own object failures
  // remain separate and reach the protected structural review path below.
  const headerPlan = canonicalRuntime.decision.responsePlan.find(item=>item.family==="APERAK" && item.outcome==="negative");
  const headerWire = runtimeMessage.message_family === "PRODAT" && runtimeMessage.raw_payload &&
    canonicalRuntime.decision.applicationDecision === "rejected"
      ? tokenizeEdifact(runtimeMessage.raw_payload) : null;
  const header202 = headerWire ? prodatHeaderFieldRejection({field:'202',sourceWire:headerWire,
    errors:headerPlan?.applicationErrors}) : null;
  const header204 = headerWire ? prodatHeaderFieldRejection({field:'204',sourceWire:headerWire,
    errors:headerPlan?.applicationErrors}) : null;
  const header313 = headerWire ? prodatHeaderFieldRejection({field:'313',sourceWire:headerWire,
    errors:headerPlan?.applicationErrors}) : null;
  const header205 = headerWire ? prodatHeaderFieldRejection({field:'205',sourceWire:headerWire,
    errors:headerPlan?.applicationErrors}) : null;
  const header206 = headerWire ? prodatHeaderFieldRejection({field:'206',sourceWire:headerWire,
    errors:headerPlan?.applicationErrors}) : null;
  if (runtimeMessage.message_family === "PRODAT" &&
      (header202?.defect || header204?.defect || header313?.defect || header205?.defect || header206?.defect)) {
    try {
      const negative = canonicalRuntime.decision.responsePlan.some(item =>
        item.family === "APERAK" && item.outcome === "negative" && Boolean(item.applicationErrors?.length));
      if (negative) {
        await createAutomaticPositiveAcks({actorUserId, sourceMessage: runtimeMessage});
      } else {
        await createAckIfMissing({actorUserId, sourceMessage: runtimeMessage, ackFamily: "CONTRL", outcome: "positive"});
      }
    } finally {
      await canonicalRuntime.sourceOwnerSession?.finish();
    }
    return runtimeMessage;
  }

  if (
    (runtimeMessage.message_family === "PRODAT" || runtimeMessage.message_family === "UTILTS")
    && acceptedTechnicalAcknowledgementCompanyId === runtimeMessage.company_id
  ) {
    const handledByActorTesting = await syncActorTestingGlobally({
      actorUserId,
      message: runtimeMessage,
      phase: "pre_business_processing",
      autoRespond: true,
      autoSend: true,
    });

    if (handledByActorTesting) {
      await canonicalRuntime.sourceOwnerSession?.finish();
      return runtimeMessage;
    }
  }

  if (
    runtimeMessage.message_family === "CONTRL" ||
    runtimeMessage.message_family === "APERAK" ||
    runtimeMessage.message_family === "UTILTS_ERR"
  ) {
    await processInboundAckMessage({ actorUserId, message: runtimeMessage });
    if(runtimeMessage.message_family==='UTILTS_ERR')await acknowledgeCommittedReceivedErr(actorUserId,runtimeMessage);
    await syncActorTestingGlobally({
      actorUserId,
      message: runtimeMessage,
      phase: "post_ack_processing",
      autoRespond: false,
      autoSend: false,
    });
    return runtimeMessage;
  }

  if (runtimeMessage.message_family === "PRODAT") {
    try {
      // A source-independent negative must survive an unavailable customer
      // effect port. Positive own responses still require its committed receipt.
      const ownNegativePlan=canonicalRuntime.decision.responsePlan.find(plan=>plan.family==='APERAK'&&plan.outcome==='negative'&&Boolean(plan.applicationErrors?.length));
      const hasOwnNegative=Boolean(ownNegativePlan);
      // The native domain partition must settle accepted own scopes before a
      // final national reply. Technical syntax ACKs remain independent.
      const earlyAckIds=hasOwnNegative && !canonicalRuntime.domainObjectCount
        ?await createAutomaticPositiveAcks({actorUserId,sourceMessage:runtimeMessage,deferProdatPositive:true}):[];
      if(runtimeMessage.message_code==='Z06'&&!canonicalRuntime.lifeEventSourceReadFailure){
        try{await applyInboundCustomerLifeEvent({message:runtimeMessage,actorUserId,
          onCustomerLifeEventCommitted:canonicalRuntime.sourceOwnerSession?.onCustomerLifeEventCommitted})}
        catch(error){await createEdielMessageEvent({actorUserId,edielMessageId:runtimeMessage.id,eventType:'manual_note',eventStatus:'warning',
          message:'Egna kundhändelser inväntar bekräftat källunderlag och skrivkvitto.',
          payload:{customerLifeEventEffect:'held',reason:formatErrorMessage(error,'Kundhändelsens native-verkställighet kunde inte bekräftas.'),authorizesBusinessEffects:false}})}
      }
      if(['Z06','Z10'].includes(runtimeMessage.message_code)){
        // The complete committed physical partition reaches the same manual
        // native owner. No first parsed graph/point is written in this branch.
        await canonicalRuntime.sourceOwnerSession?.finish();
        const inboundCase=await createOrUpdateInboundProdatCase({actorUserId,message:runtimeMessage});
        const ackIds=hasOwnNegative?earlyAckIds
          :[(await createAckIfMissing({actorUserId,sourceMessage:runtimeMessage,ackFamily:'CONTRL',outcome:'positive'})).id];
        await createEdielMessageEvent({actorUserId,edielMessageId:runtimeMessage.id,eventType:'validated',eventStatus:'warning',
          message:'PRODAT-objekten har lagts i källbunden granskning. Egna slutliga svar följer deras beständiga skrivkvitton.',
          payload:{inboundCaseId:inboundCase?.id??null,createdAckMessageIds:ackIds,reviewRequired:true,
            objectScopes:canonicalRuntime.decision.prodatApplicationValidation?.objects.map(object=>({objectId:object.objectId,
              identityAgency:object.identityAgency,lineIndex:object.registers[0]?.segmentIndex,applicationDecision:object.applicationDecision}))??[]}});
        return runtimeMessage;
      }
      if(canonicalRuntime.domainObjectCount>0){
        // One complete source enters the native object partition. Neither a
        // first parsed point nor a rendered subset may select its effects.
        const initialAckIds:string[]=[];
        // The native apply is one transaction: a database failure (e.g. its
        // final audit write) is rolled back server-side and leaves nothing
        // committed. Hold such a source for review; no positive reply follows.
        // Client-side invariant errors still reject the reception.
        const supply=['Z04','Z05'].includes(runtimeMessage.message_code)
          ?await applySupplyMarketSource({actorUserId,message:runtimeMessage}).catch(async(error:unknown)=>{
            if(error instanceof Error||!error||typeof error!=='object'||typeof (error as {code?:unknown}).code!=='string')throw error;
            await createEdielMessageEvent({actorUserId,edielMessageId:runtimeMessage.id,eventType:'manual_note',eventStatus:'warning',
              message:'Leveranskällan kunde inte verkställas och har rullats tillbaka; den hålls för granskning.',
              payload:{supplySourceApply:'rolled_back',reason:formatErrorMessage(error,'Leveranskällans transaktion misslyckades.')}})
            return {applied:false,reason:'supply_source_apply_rolled_back',idempotent:false,periods:[],commits:[],partition:null,effectReceiptIds:[],fullyApplied:false,reviewRequired:true}
          }):null;
        const permission=supply===null?await applyPermissionMarketSource({actorUserId,message:runtimeMessage}):null;
        if(supply){
          for(const scope of supply.commits)await publishSourceSwitchCommit(canonicalRuntime.sourceOwnerSession?.onSwitchCommitted,{
            message:{...runtimeMessage,customer_id:scope.customerId,metering_point_id:scope.meteringPointId,site_id:scope.siteId},
            switchRequestId:scope.switchRequestId,supplyPeriodId:scope.supplyPeriodId});
          for(const effectReceiptId of supply.effectReceiptIds){
            try{await projectSupplyEndFollowup({actorUserId,companyId:runtimeMessage.company_id!,effectReceiptId})}
            catch(error){await createEdielMessageEvent({actorUserId,edielMessageId:runtimeMessage.id,eventType:'manual_note',eventStatus:'warning',
              message:'Slutmätvärdesuppgiften inväntar sin beständiga effektkoppling. Leveransutfallet är redan fastställt.',
              payload:{effectReceiptId,supplyEndFollowup:'held',reason:formatErrorMessage(error,'Operativ uppgift kunde inte projiceras.')}})}
          }
        }
        await canonicalRuntime.sourceOwnerSession?.finish();
        const applied=supply?.applied??permission?.applied??false;
        const fullyApplied=supply?.fullyApplied??permission?.fullyApplied??false;
        const reviewRequired=supply?.reviewRequired??permission?.reviewRequired??!fullyApplied;
        // Complete the immutable own partition before projecting the final
        // negative/positive national reply; a failed effect port returns held.
        const ownAckIds=applied?await createCommittedDomainAcks(actorUserId,runtimeMessage)
          :hasOwnNegative?await createAutomaticPositiveAcks({actorUserId,sourceMessage:runtimeMessage,deferProdatPositive:true}):[];
        // Preserve the established single-supply projections through an exact
        // native replay only after every scope is committed. Multipart and
        // permission responses never select a first parsed target here.
        if(supply?.fullyApplied&&canonicalRuntime.domainObjectCount===1){
          try{await processInboundProdatMessage({actorUserId,message:runtimeMessage,committedSupplyResult:supply})}
          catch(error){await createEdielMessageEvent({actorUserId,edielMessageId:runtimeMessage.id,eventType:'manual_note',eventStatus:'warning',
            message:'Leveransutfallet och dess kvitto är fastställda; övriga projektioner inväntar granskning.',
            payload:{supplyAncillaryProjection:'held',reason:formatErrorMessage(error,'Operativ projektion kunde inte slutföras.')}})}
        }
        // A physical register structure the canonical decision already answered
        // negatively has no reviewable own case; it must not fail the reception.
        const inboundCase=await createOrUpdateInboundProdatCase({actorUserId,message:runtimeMessage}).catch((error:unknown)=>{
          if(error instanceof Error&&error.message.startsWith('PRODAT_REGISTER_STRUCTURE_INVALID:')&&canonicalRuntime.decision.applicationDecision==='rejected')return null;
          throw error;
        });
        await createEdielMessageEvent({actorUserId,edielMessageId:runtimeMessage.id,eventType:'validated',eventStatus:reviewRequired?'warning':'success',
          message:reviewRequired?'Egna objekt har behandlats där källunderlaget räcker; övriga objekt inväntar granskning.':'Egna objekt och deras slutliga svar följer beständiga skrivkvitton.',
          payload:{inboundCaseId:inboundCase?.id??null,createdAckMessageIds:[...initialAckIds,...ownAckIds],reviewRequired,fullyApplied,
            sourceObjectPartition:supply?.partition??permission?.manifest??null,committedEffectReceiptIds:supply?.effectReceiptIds??[],
            permissionResults:permission?.permissionResults??null,applied,idempotent:supply?.idempotent??permission?.idempotent??false}});
        return runtimeMessage;
      }
      // Other object failures still receive their prescribed negative response
      // before legacy single-target processing; they grant no graph writes.
      if(canonicalRuntime.decision.prodatApplicationValidation?.objects.some(object=>object.applicationDecision!=='accepted')){
        await createAutomaticPositiveAcks({actorUserId,sourceMessage:runtimeMessage});
        return runtimeMessage;
      }
      await processInboundProdatMessage({ actorUserId, message: runtimeMessage,
        onSourceSwitchCommitted: canonicalRuntime.sourceOwnerSession?.onSwitchCommitted });
    } finally {
      await canonicalRuntime.sourceOwnerSession?.finish();
    }
    return runtimeMessage;
  }

  if (runtimeMessage.message_family === "UTILTS") {
    const utiltsResult = await processInboundUtiltsMessage({
      actorUserId,
      edielMessageId: runtimeMessage.id,
      canonicalPolicy: canonicalRuntime.decision.policy,
      canonicalDecision: canonicalRuntime.decision,
    });
    await applyInboundBusinessStateMachine({
      actorUserId,
      message: runtimeMessage,
      source: "utilts_processing",
      utiltsInternalReviewRequired: utiltsResult.internalReviewRequired === true,
    });
    return runtimeMessage;
  }

  const ackIds = await createAutomaticPositiveAcks({
    actorUserId,
    sourceMessage: runtimeMessage,
  });
  const ackSnapshot = await readCanonicalAckSnapshot(runtimeMessage, actorUserId);

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: runtimeMessage.id,
    eventType: "validated",
    eventStatus: "warning",
    message:
      "Inbound meddelande kvitterades automatiskt men saknar ännu stark processkoppling.",
    payload: {
      createdAckMessageIds: ackIds,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  });

  return runtimeMessage;
}

export async function pollAndIngestEdielMailbox(params: {
  actorUserId: string;
  mailbox?: string | null;
  mailboxId?: string | null;
  communicationRouteId?: string | null;
  companyId?: string | null;
  environment?: "test" | "production" | null;
  force?: boolean;
  limit?: number;
  markSeen?: boolean;
  includeSeenRecent?: boolean;
  recentDays?: number;
  sharedOnly?: boolean;
  createDiagnosticMessagesForUnresolved?: boolean;
}) {
  const actorUserId = ensureActorUserId(params.actorUserId);
  const routeProfile = params.communicationRouteId
    ? await getEdielRouteProfileByCommunicationRouteId(
        params.communicationRouteId,
        {
          companyId: params.companyId ?? null,
        },
      )
    : null;
  const legacyMailboxAsId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      params.mailbox ?? "",
    )
      ? params.mailbox
      : null;
  const resolvedMailboxId =
    params.mailboxId ?? routeProfile?.mailbox_id ?? legacyMailboxAsId;
  const targetCompanyId = params.companyId ?? routeProfile?.company_id ?? null;
  const useSharedMailbox = params.sharedOnly ?? !resolvedMailboxId;

  const result = await runInboundEdielMailEngine({
    actorUserId,
    companyId: useSharedMailbox ? null : targetCompanyId,
    environment: params.environment ?? routeProfile?.environment ?? "test",
    mailboxId: resolvedMailboxId,
    sharedOnly: useSharedMailbox,
    force: params.force ?? true,
    markSeen: params.markSeen,
    includeSeenRecent: params.includeSeenRecent,
    recentDays: params.recentDays,
    messageLimitPerMailbox: params.limit ?? 10,
    createDiagnosticMessagesForUnresolved:
      params.createDiagnosticMessagesForUnresolved ?? false,
  });
  const incoming = await listEdielMessagesByIds(result.edielMessageIds, {
    companyId: targetCompanyId,
  });

  for (const message of incoming) {
    await processInboundEdielMessage({
      actorUserId,
      edielMessageId: message.id,
    });
  }

  return Object.assign(incoming, { pollResult: result });
}

export async function createNegativeUtiltsResponse(params: {
  actorUserId: string;
  edielMessageId: string;
  messageText: string;
}) {
  const actorUserId = ensureActorUserId(params.actorUserId);
  const source = await getEdielMessageById(params.edielMessageId);
  if (!source) throw new Error("Källmeddelande hittades inte");
  if (source.message_family !== "UTILTS") {
    throw new Error(`Meddelande ${source.id} är inte UTILTS.`);
  }

  const utiltsErr = await createAckIfMissing({
    actorUserId,
    sourceMessage: source,
    ackFamily: "UTILTS_ERR",
    messageText: params.messageText,
  });

  const ackSnapshot = await readCanonicalAckSnapshot(source, actorUserId);

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: source.id,
    eventType: "utilts_err_sent",
    eventStatus: "warning",
    message: "UTILTS-ERR-utkast skapat via canonical kernel.",
    payload: {
      utiltsErrMessageId: utiltsErr.id,
      canonicalAckState: ackSnapshot.canonicalAckState,
      ackMessages: ackSnapshot.ackMessages,
    },
  });

  return utiltsErr;
}
