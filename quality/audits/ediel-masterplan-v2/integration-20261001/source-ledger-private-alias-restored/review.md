# Private source alias resolver restoration

Two actual private alias SECURITY DEFINER functions retained a public resolver path. Their exact bodies were extracted from authentic clean replay artifact 11144034780 at public head0373d6d0; hashes match the recorded b7fa3112/f4fcc0c6 pair. The new forward changes only search_path to pg_catalog and rejects body drift. It preserves every other pg_proc field and every other configuration entry at its original position, including a tested nonempty lock_timeout.

The conditional public CREATE overload probe is RED before the forward and GREEN afterward using the actual Z02 first-refusal consumer. This establishes resolver hardening; it does not establish that an application role currently has public CREATE or that the private alias is externally callable. Three application roles cannot execute either alias before or after in the bounded ACL model. Actual replay-wide role inheritance/owner grants remain native evidence requirements.

The test uses actual replay bodies and explicitly synthetic dependency tables and owners. It creates no accepted source, supply, contract, invoice or policy approval. The body bytes, original native refusal, all catalogue fields outside proconfig, exact other config entries, idempotent second application and hash-drift rollback are checked. Actual Supabase/native/browser/exact-head CI and whole masterplan approval remain pending.

This is a newly recreated package after workspace loss. It does not restore the previous local commit identity or reuse its previous test count as a current receipt. See verification.json for the newly executed checks.
