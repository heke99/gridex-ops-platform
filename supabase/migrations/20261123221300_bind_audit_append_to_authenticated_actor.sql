CREATE POLICY audit_logs_authenticated_actor_insert ON public.audit_logs
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  actor_user_id = (SELECT auth.uid())
  AND actor_type = 'user'
  AND system_actor IS NULL
);
