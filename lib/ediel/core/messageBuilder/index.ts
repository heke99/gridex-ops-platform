// lib/ediel/core/messageBuilder/index.ts

export {
  preflightEdielPayload,
  preflightEdielMessageRow,
  type EdielPayloadPreflightIssue,
  type EdielPayloadPreflightResult,
} from '@/lib/ediel/core/messageBuilder/payloadPreflight'

export {
  EDIEL_MESSAGE_PROFILES,
  expectedProfileKeysForFamily,
  profileForMessage,
  segmentCount,
  tagOf,
  type EdielBuilderFamily,
  type EdielMessageProfile,
  type SegmentFieldLimit,
  type SegmentRequirement,
} from '@/lib/ediel/core/messageBuilder/segmentSchema'

export {
  compositeComponent,
  effectiveEdifactLength,
  escapeEdifactValue,
  normalizeEdifactIdentifier,
  segmentElement,
  segmentTag,
} from '@/lib/ediel/core/messageBuilder/fieldFormatter'

export {
  assertUntUnzReferences,
  countMessagesInInterchange,
  countSegmentsBetweenUnhAndUnt,
  edifactSegmentsFromPayload,
} from '@/lib/ediel/core/messageBuilder/segmentCounter'
