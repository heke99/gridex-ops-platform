// Stable public facade. Implementations are split into 2 characterized modules.
export type { EdielSmtpMimeMode } from './index.part-1'
export { isSupportedSmtpMimeMode } from './index.part-1'
export { sendEdielMessageViaSmtp } from './index.part-2'
