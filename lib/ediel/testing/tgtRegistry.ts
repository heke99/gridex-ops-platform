// Stable public facade. Implementations are split into 4 characterized modules.
export type { EdielTgtExpectedStep, EdielTgtTestCaseDefinition, EdielTgtStepMatch, EdielTgtRunEvaluation } from './tgtRegistry.part-1'
export { EDIEL_TGT_TEST_CASES } from './tgtRegistry.part-3'
export type { EdielTgtRunEvaluationOptions, EdielTgtNextAction, EdielTgtCoverageSummary } from './tgtRegistry.part-4'
export { getEdielTgtTestCases, getEdielTgtTestCaseByCode, evaluateEdielTgtRun, getFileEngineTestcaseTemplates, getEdielTgtNextAction, getEdielTgtCoverageSummary } from './tgtRegistry.part-4'
