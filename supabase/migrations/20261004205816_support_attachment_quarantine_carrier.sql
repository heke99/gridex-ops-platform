-- Support attachments are stored as opaque bytes before content inspection.
-- Admit that private quarantine carrier without changing the three detected /
-- released formats, bucket visibility, limits, ownership, policies or grants.
-- No outer transaction boundary: the exact source can be rehearsed in rollback.
DO $guard$
DECLARE
  v_bucket_public boolean;
  v_file_limit bigint;
  v_allowed text[];
  v_sorted text[];
BEGIN
  SELECT b.public, b.file_size_limit, b.allowed_mime_types
    INTO v_bucket_public, v_file_limit, v_allowed
    FROM storage.buckets b
    WHERE b.id = 'support-case-attachments'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_attachment_bucket_missing';
  END IF;
  IF v_bucket_public IS DISTINCT FROM false
     OR v_file_limit IS DISTINCT FROM 10485760::bigint THEN
    RAISE EXCEPTION 'support_attachment_bucket_prerequisite_mismatch';
  END IF;

  v_sorted := ARRAY(SELECT mime FROM unnest(v_allowed) AS t(mime) ORDER BY mime);
  IF v_sorted IS DISTINCT FROM ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
     AND v_sorted IS DISTINCT FROM ARRAY['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png']::text[] THEN
    RAISE EXCEPTION 'support_attachment_bucket_mime_prerequisite_mismatch';
  END IF;

  IF v_sorted = ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[] THEN
    UPDATE storage.buckets
      SET allowed_mime_types = array_append(v_allowed, 'application/octet-stream')
      WHERE id = 'support-case-attachments';
  END IF;
END;
$guard$;
