// Compatibility export only.
//
// Certified AGT/TGT acknowledgement overrides are system-test fixtures and live
// under lib/ediel/testing. Production UTILTS ACK semantics remain owned by the
// canonical ACK/runtime engines and must never be defined in this rulebook path.
export {
  applyUtiltsTestAckPlanOverride as applyCertifiedUtiltsAckPolicy,
} from '@/lib/ediel/testing/utiltsAckOverrides'
