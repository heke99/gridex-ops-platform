import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'

export const db01ContrlSchemaSha256 = '3838f1fd17e8a72a7086868747071106147bc37615626ebf1107c1640b07383c'

/** Historical DB01 schema-only capture from 1616806c65b4d09d172e147244e6e82cabc19e1d.
 * The live native workflow independently admits the catalogue for its checkout. */
export function readDb01ContrlSchemaCapture(): string {
  const packed = readFileSync(new URL('../fixtures/db01-contrl-schema-3838f1fd.sql.gz', import.meta.url))
  const schema = gunzipSync(packed, {maxOutputLength: 16 * 1024 * 1024})
  if (createHash('sha256').update(schema).digest('hex') !== db01ContrlSchemaSha256) {
    throw new Error('db01_contrl_schema_fixture_hash_mismatch')
  }
  return schema.toString('utf8')
}
