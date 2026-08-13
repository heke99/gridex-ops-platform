# Ediel architecture

Runtime rule selection starts in `ediel_rule_packs` / `ediel_message_profiles` and is consumed through `resolveCanonicalRulePack`. TypeScript canonical profiles provide deterministic parser, validator, renderer and UI metadata. Route, tenant, rule-pack and payload snapshots are bound before outbox creation. Legacy registries may adapt canonical data but must not select conflicting semantics.

The inbound order is raw evidence → tenant resolution → canonical parse/validation → transaction/business matching → ACK decision → domain state machine → audit event. Unknown tenant or object identity fails closed to quarantine/manual review.
