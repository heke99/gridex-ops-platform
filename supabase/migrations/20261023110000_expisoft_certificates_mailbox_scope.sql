-- FINDINGS F96 (reality simulation 2026-10-23): the Expisoft certificate directory publishes one encryption
-- certificate per Ediel mailbox/actor, but lib/ediel/security/expisoftCertificateDirectory.ts stored every one as
-- message_family/message_type 'PRODAT' (columns and metadata). The approved family gate (TR-06,
-- certificateMessageScopeBlocker) then rightly refused them for CONTRL, APERAK and UTILTS: no technical reply or
-- UTILTS file to a grid owner could be encrypted in production (all 168 active expisoft_ldap recipient
-- certificates there are PRODAT/PRODAT). The materializer now stores them mailbox-scoped (NULL); a valid row is
-- not refreshed by any cron, so existing rows are rescoped here once.
-- Narrow: only rows that lookup wrote (source expisoft_ldap, outbound_recipient) and still carry the invented
-- PRODAT/PRODAT. Owner, subaddress, environment, usage, purpose, status and validity are untouched. Each row keeps
-- metadata.f96_rescoped_from='PRODAT/PRODAT' for audit and rollback.
UPDATE public.ediel_certificates
   SET message_family = NULL,
       message_type = NULL,
       metadata = (coalesce(metadata, '{}'::jsonb) - 'messageFamily' - 'message_family' - 'messageType' - 'message_type')
                  || jsonb_build_object('f96_rescoped_from', 'PRODAT/PRODAT'),
       updated_at = now()
 WHERE source = 'expisoft_ldap'
   AND usage = 'outbound_recipient'
   AND upper(message_family) = 'PRODAT'
   AND upper(message_type) = 'PRODAT';
