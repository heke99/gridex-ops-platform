# Task11c CI1 bounded correction

Status: IMPLEMENTED_NOT_VERIFIED — frozen for scoped independent review and hosted quality rerun.

Base: `aaeb11c7b61adf808e5532881ada9a5c3a79a15a`, tree `56435f2e`. Root-provided exact CI evidence: OPS34686322908/job103533810532 failed lint before types/Vitest on three `@next/next/no-assign-module-variable` errors in these two proof files. Root-provided separate native receipt: job103533810482 SUCCESS with42 constructors,10baseline,129candidate, real inherited ACL recovery/repeat/row/catalog/cleanup. Native success is existing hosted evidence, not a local run by this fix.

Changed only the three local VM variable bindings named `module` to `sourceModule`/`boundaryModule`, consistently including all references. Removed the unused page transport fake's `table` parameter. No policy, production, permanent-test, SQL, fixture, manifest, workflow, dependency, rule suppression/config, memory, index, commit/push, or agent changes. Prior SQL candidate and native acceptance remain unchanged. Used the already-read verification-before-completion/TDD guidance; this lexical correction follows the exact failing CI observation, with the covering actual-source cases retained.

## Verification executed

- `node --check quality/audits/proofs/permission-diagnostic-regression.mjs`: PASS.
- `node --check quality/audits/proofs/permission-diagnostic-page-regression.mjs`: PASS.
- `node --experimental-vm-modules quality/audits/proofs/permission-diagnostic-regression.mjs`: PASS13/13.
- `node --experimental-vm-modules quality/audits/proofs/permission-diagnostic-page-regression.mjs`: PASS7/7.
- `git diff --check`: PASS.

Only Node VM/type-stripping experimental warnings appeared. No dependency install or whole suite rerun. Hosted lint/typecheck/Vitest/build for this correction are NOT_RUN locally and remain root's next gate. The probes' NOT_RUN summaries describe their own execution boundaries, not the separate accepted hosted native receipt.

## Exact owned files

| File | SHA256 |
| --- | --- |
| `quality/audits/proofs/permission-diagnostic-page-regression.mjs` | `e7b2c782225c522ab5a811843d2d82d8c98a62b1c94b8c41d8f86b8826dc129c` |
| `quality/audits/proofs/permission-diagnostic-regression.mjs` | `8ed21a35529485ac83bcf5d5d47208e356e8096753f97a130537f263c933f5a2` |

Report SHA is provided separately to avoid a self-referential hash.

## Exact implementation diff

```diff
diff --git a/quality/audits/proofs/permission-diagnostic-page-regression.mjs b/quality/audits/proofs/permission-diagnostic-page-regression.mjs
index 4cfcbaa5..9da98978 100644
--- a/quality/audits/proofs/permission-diagnostic-page-regression.mjs
+++ b/quality/audits/proofs/permission-diagnostic-page-regression.mjs
@@ -28,7 +28,7 @@ for (const test of cases) {
   const service = {
     rpc: async (name, args) => { calls.push(['diagnostic', name, args]); return { data: test.data, error: test.error ?? null } },
     auth: { admin: { getUserById: async id => { calls.push(['target-auth', id]); return { data: { user: { id } }, error: null } } } },
-    from: table => { const query = { select: () => query, eq: () => query, order: () => query, in: () => query, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) }; return query },
+    from: () => { const query = { select: () => query, eq: () => query, order: () => query, in: () => query, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) }; return query },
   }
   const session = {
     auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
@@ -55,9 +55,9 @@ for (const test of cases) {
     if (mocks[id] || id.startsWith('node:')) {
       if (cache.has(id)) return cache.get(id)
       const object = mocks[id] ?? await import(id)
-      const module = new vm.SyntheticModule(Object.keys(object), function () { for (const [key, value] of Object.entries(object)) this.setExport(key, value) }, { context })
-      cache.set(id, module)
-      return module
+      const boundaryModule = new vm.SyntheticModule(Object.keys(object), function () { for (const [key, value] of Object.entries(object)) this.setExport(key, value) }, { context })
+      cache.set(id, boundaryModule)
+      return boundaryModule
     }
     const relative = id.startsWith('@/') ? id.slice(2) : id.startsWith('.') ? path.join(path.dirname(importer.identifier), id) : id
     const file = path.resolve(relative.endsWith('.tsx') ? relative : relative.endsWith('.ts') ? relative : relative + '.ts')
@@ -68,9 +68,9 @@ for (const test of cases) {
       assert.ok(rendering > 0, 'exact JSX rendering boundary')
       source = source.slice(0, rendering) + '\n return { count: effectivePermissions.size };\n}\n'
     }
-    const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file, context })
-    cache.set(file, module)
-    return module
+    const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file, context })
+    cache.set(file, sourceModule)
+    return sourceModule
   }
   try {
     const page = await load('app/admin/users/[id]/page.tsx')
diff --git a/quality/audits/proofs/permission-diagnostic-regression.mjs b/quality/audits/proofs/permission-diagnostic-regression.mjs
index 7cfda1eb..5a1bb8b8 100644
--- a/quality/audits/proofs/permission-diagnostic-regression.mjs
+++ b/quality/audits/proofs/permission-diagnostic-regression.mjs
@@ -33,17 +33,17 @@ for (const [name, data, error, expected] of cases) {
   }
   const boundary = new vm.SyntheticModule(['supabaseService'], function () { this.setExport('supabaseService', service) }, { context })
   const serverOnly = new vm.SyntheticModule([], function () {}, { context })
-  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file, context })
-  await module.link(id => id === 'server-only' ? serverOnly : id === '@/lib/supabase/service' ? boundary : Promise.reject(new Error(`Unexpected import ${id}`)))
-  await module.evaluate()
+  const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file, context })
+  await sourceModule.link(id => id === 'server-only' ? serverOnly : id === '@/lib/supabase/service' ? boundary : Promise.reject(new Error(`Unexpected import ${id}`)))
+  await sourceModule.evaluate()
   try {
     if (expected) {
-      const result = await module.namespace.getAdminUserById(actor, target)
+      const result = await sourceModule.namespace.getAdminUserById(actor, target)
       assert.deepEqual(structuredClone(result.effectivePermissions), expected)
       assert.deepEqual(structuredClone(calls[0]), ['rpc', 'canonical_get_platform_user_permission_diagnostic', { p_actor_user_id: actor, p_target_user_id: target }])
       assert.deepEqual(calls[1], ['auth', target])
     } else {
-      await assert.rejects(module.namespace.getAdminUserById(actor, target), /Behörighetsdiagnostiken är inte tillgänglig/)
+      await assert.rejects(sourceModule.namespace.getAdminUserById(actor, target), /Behörighetsdiagnostiken är inte tillgänglig/)
       assert.equal(calls.some(([kind]) => kind === 'auth' || kind === 'from'), false)
       assert.ok(JSON.stringify(logs).length < 500)
     }
```
