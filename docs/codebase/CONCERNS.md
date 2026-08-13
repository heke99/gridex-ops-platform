# Concerns

- Ediel UTILTS field-by-field coverage is incomplete in the live canonical registry.
- Aggregate/forecast UTILTS business persistence is incomplete.
- Local diagnostics run on Node 24 while the supported release runtime is Node 22.
- Only the connected dev Supabase project is visible; staging/production parity is externally blocked.
- Supabase authenticated security-definer warnings require continued per-function review because several routines intentionally support RLS/authenticated context.
