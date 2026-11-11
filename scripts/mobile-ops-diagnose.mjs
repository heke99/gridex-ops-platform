// Log only fixed error metadata; never upstream messages, headers or payloads.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const { customers } = JSON.parse(await readFile(process.argv[2], 'utf8'))
const { fetchOpsCustomerResource } = await import(pathToFileURL(resolve(process.env.GRIDEX_WEB_PATH ?? 'gridex-web', 'lib/ops/client/portal.ts')).href)
for (const customer of customers) {
  try {
    await fetchOpsCustomerResource({ userId: customer.userId, customerNumber: customer.number, externalCustomerId: customer.number }, 'invoices', customer.references.invoices)
    console.log('PASS direct OPS invoice transport and contract: customer ' + customer.label)
  } catch (error) {
    console.log(JSON.stringify({ stage: 'direct-ops-invoice', status: error.status ?? null, code: error.code ?? null,
      validation: (error.details?.errors ?? []).map(e => ({ path: e.instancePath, keyword: e.keyword, schema: e.schemaPath })) }))
    throw new Error('Direct OPS invoice diagnosis failed; secret-free metadata above')
  }
}
