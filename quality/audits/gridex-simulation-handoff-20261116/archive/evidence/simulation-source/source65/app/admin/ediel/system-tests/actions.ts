"use server";

// Stable public facade. Implementations are split into 4 characterized modules.
import * as implementation1 from './actions.part-1'
import * as implementation2 from './actions.part-2'
import * as implementation3 from './actions.part-3'
import * as implementation4 from './actions.part-4'

export async function saveSimpleSystemTestCompanySetupAction(...args: Parameters<typeof implementation1.saveSimpleSystemTestCompanySetupAction>) {
  return implementation1.saveSimpleSystemTestCompanySetupAction(...args)
}

export async function createAndSendSystemTestAckAction(...args: Parameters<typeof implementation2.createAndSendSystemTestAckAction>) {
  return implementation2.createAndSendSystemTestAckAction(...args)
}

export async function unlinkSystemTestMessageAction(...args: Parameters<typeof implementation2.unlinkSystemTestMessageAction>) {
  return implementation2.unlinkSystemTestMessageAction(...args)
}

export async function softDeleteSystemTestMessageAction(...args: Parameters<typeof implementation2.softDeleteSystemTestMessageAction>) {
  return implementation2.softDeleteSystemTestMessageAction(...args)
}

export async function deleteSystemTestRunAction(...args: Parameters<typeof implementation2.deleteSystemTestRunAction>) {
  return implementation2.deleteSystemTestRunAction(...args)
}

export async function deleteSystemTestArtifactAction(...args: Parameters<typeof implementation2.deleteSystemTestArtifactAction>) {
  return implementation2.deleteSystemTestArtifactAction(...args)
}

export async function validateSystemTestPayloadAction(...args: Parameters<typeof implementation2.validateSystemTestPayloadAction>) {
  return implementation2.validateSystemTestPayloadAction(...args)
}

export async function pollAndSyncTgtSystemTestMailboxAction(...args: Parameters<typeof implementation3.pollAndSyncTgtSystemTestMailboxAction>) {
  return implementation3.pollAndSyncTgtSystemTestMailboxAction(...args)
}

export async function syncRulebookStaticRulesAction(...args: Parameters<typeof implementation3.syncRulebookStaticRulesAction>) {
  return implementation3.syncRulebookStaticRulesAction(...args)
}

export async function cloneRuleVersionToDraftAction(...args: Parameters<typeof implementation3.cloneRuleVersionToDraftAction>) {
  return implementation3.cloneRuleVersionToDraftAction(...args)
}

export async function runRulebookRegressionAction(...args: Parameters<typeof implementation3.runRulebookRegressionAction>) {
  return implementation3.runRulebookRegressionAction(...args)
}

export async function activateRuleVersionAction(...args: Parameters<typeof implementation3.activateRuleVersionAction>) {
  return implementation3.activateRuleVersionAction(...args)
}

export async function parseAndValidateRulebookPayloadAction(...args: Parameters<typeof implementation3.parseAndValidateRulebookPayloadAction>) {
  return implementation3.parseAndValidateRulebookPayloadAction(...args)
}

export async function importStructuredTestDataAction(...args: Parameters<typeof implementation3.importStructuredTestDataAction>) {
  return implementation3.importStructuredTestDataAction(...args)
}

export async function executeRulebookTestCaseAction(...args: Parameters<typeof implementation3.executeRulebookTestCaseAction>) {
  return implementation3.executeRulebookTestCaseAction(...args)
}

export async function sendSystemTestOutboundMessageAction(...args: Parameters<typeof implementation4.sendSystemTestOutboundMessageAction>) {
  return implementation4.sendSystemTestOutboundMessageAction(...args)
}

export async function createAndSendSystemTestOutboundForRunAction(...args: Parameters<typeof implementation4.createAndSendSystemTestOutboundForRunAction>) {
  return implementation4.createAndSendSystemTestOutboundForRunAction(...args)
}
