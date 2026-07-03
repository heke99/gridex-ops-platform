// Unit tests never talk to a real database, but several modules construct the
// Supabase service client at import time and require these env vars to exist.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://unit-test-placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-placeholder-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-placeholder-service-role-key'
