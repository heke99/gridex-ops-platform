# Borttagningar

Patchen tar inte bort några projektfiler, routes, migrationer eller publika
funktioner.

Legacy-alias tas endast bort från serialiserade publika svar:

- integration context: `meta`
- website quote: `quote`
- fel: parallella top-level `code`, `error_code`, `message`, `stage`,
  `error_stage`, `field`, `retryable`, `blockers` och `details`
- webhook: `id`, `type`, rawa interna `*_id` och `aggregate.id`

Äldre köade webhookleveranser återprojiceras vid dispatch i stället för att
raderas eller muteras destruktivt.
