#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

const file = 'app/developers/customer-portal-api/page.tsx'
const source = fs.readFileSync(file, 'utf8')
const from = `            <h3 className="text-lg font-semibold text-slate-950">Successful checkout response</h3>\n            <CopyCodeBlock code={checkoutResponse} language="json" />`
const to = `            <h3 className="text-lg font-semibold text-slate-950">Successful checkout response</h3>\n            <p className="leading-7 text-slate-700">\n              The immediate customer-facing checkout result is returned in <code>data.checkout</code>. Use that object for the post-submit UI instead of deriving success from internal processing states.\n            </p>\n            <CopyCodeBlock code={checkoutResponse} language="json" />`
if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('Could not locate successful checkout response section')
  fs.writeFileSync(file, source.replace(from, to))
  console.log(`${file}: added explicit data.checkout guidance`)
} else {
  console.log(`${file}: already synchronized`)
}
