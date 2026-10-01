'use strict';

// Pure evaluation of the actual rollback artifact's small Boolean IF gates.
// No SQL, database, Auth, role switch, RLS or service command executes here.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { test } = require('node:test');

const wrapper = fs.readFileSync(path.join(__dirname, 'tenantservice-baseline-rollback-20261001.sh'), 'utf8');
const proof = wrapper.split("<<'OLD_SCHEMA_PROOF'\n")[1].split('\nOLD_SCHEMA_PROOF\n')[0];
const originalRaw = String.raw`declare denied boolean:=false;
begin
 begin update public.customers set email='denied-raw@example.invalid'
  where id='e4954930-0000-4000-8000-000000000031';
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'baseline_rollback_authenticated_raw_write_not_denied'; end if;
end;`;

function block(source, tag) {
  const begin = 'do $' + tag + '$\n';
  const end = '\n$' + tag + '$;';
  assert.equal(source.split(begin).length, 2, 'exact actual DO boundary: ' + tag);
  return source.split(begin)[1].split(end)[0];
}
const raw = block(proof, 'old_authenticated_raw_write_denial');

// Only this grammar is supported: identifiers, NOT/AND/OR, NULL predicates,
// and IS [NOT] DISTINCT FROM. Unexpected syntax fails instead of being guessed.
// The evaluator implements SQL Boolean/null semantics for these gates only.
function evaluate(expression, values) {
  const tokens = [];
  const lex = /\s*(?:([A-Za-z_][A-Za-z_0-9]*)|(-?\d+)|([()]))/y;
  let pos = 0;
  while (pos < expression.trimEnd().length) {
    lex.lastIndex = pos;
    const match = lex.exec(expression);
    assert.ok(match, 'unsupported gate syntax at ' + expression.slice(pos));
    tokens.push(match[1] ? match[1].toLowerCase() : match[2] ? Number(match[2]) : match[3]);
    pos = lex.lastIndex;
  }
  let index = 0;
  function take(token) {
    if (tokens[index] === token) { index++; return true; }
    return false;
  }
  function requireToken(token) { assert.ok(take(token), 'expected gate token ' + token); }
  function operand() {
    if (take('(')) { const value = or(); requireToken(')'); return value; }
    const token = tokens[index++];
    if (typeof token === 'number') return token;
    if (token === 'null') return null;
    if (token === 'true') return true;
    if (token === 'false') return false;
    assert.ok(Object.hasOwn(values, token), 'unknown gate variable ' + token);
    return values[token];
  }
  function compare() {
    const left = operand();
    if (!take('is')) return left;
    const negate = take('not');
    let equal;
    if (take('null')) equal = left === null;
    else {
      requireToken('distinct'); requireToken('from');
      equal = !isDeepStrictEqual(left, operand());
    }
    return negate ? !equal : equal;
  }
  function not() {
    if (!take('not')) return compare();
    const value = not();
    return value === null ? null : !value;
  }
  function and() {
    let value = not();
    while (take('and')) {
      const right = not();
      value = value === false || right === false ? false : value === null || right === null ? null : true;
    }
    return value;
  }
  function or() {
    let value = and();
    while (take('or')) {
      const right = and();
      value = value === true || right === true ? true : value === null || right === null ? null : false;
    }
    return value;
  }
  const result = or();
  assert.equal(index, tokens.length, 'entire actual predicate consumed');
  return result;
}

function observe(source, completion) {
  // Only an actual insufficient_privilege handler can classify a 42501 receipt.
  // Other controlled error receipts propagate with the original object.
  assert.match(source, /exception\s+when\s+insufficient_privilege\s+then\s+denied\s*:=\s*true\s*;/i);
  assert.doesNotMatch(source, /when\s+others/i);
  if (completion.error && completion.error.code !== '42501') throw completion.error;
  const count = source.match(/get\s+diagnostics\s+(\w+)\s*=\s*row_count\s*;/i);
  const values = { denied: completion.error?.code === '42501',
    before_row: completion.before, after_row: completion.after };
  if (count) values[count[1].toLowerCase()] = completion.error ? null : completion.rowCount;
  const gates = [...source.matchAll(/if\s+([\s\S]*?)\s+then\s+raise\s+exception\s+'([^']+)';\s*end\s+if;/gi)];
  assert.ok(gates.length > 0, 'actual exception gate exists');
  for (const gate of gates) {
    if (evaluate(gate[1], values) === true) throw new Error(gate[2]);
  }
  return 'denied_without_effect';
}
const before = { id: 'synthetic-target', email: 'contact-only@example.invalid',
  metadata: { synthetic: true }, updated_at: '2026-10-01T00:00:00Z' };
const changed = { ...before, email: 'denied-raw@example.invalid' };
const denied = { code: '42501', message: 'controlled receipt only' };

test('the actual oracle accepts zero affected rows and an unchanged visible target', () => {
  assert.equal(observe(raw, { rowCount: 0, before, after: { ...before } }), 'denied_without_effect');
});
test('the actual oracle accepts 42501 only with an unchanged visible target', () => {
  assert.equal(observe(raw, { error: denied, before, after: { ...before } }), 'denied_without_effect');
});
test('positive row_count is rejected even when assigned data happens to be unchanged', () => {
  assert.throws(() => observe(raw, { rowCount: 1, before, after: before }),
    /baseline_rollback_authenticated_raw_write_not_denied/);
});
test('a missing row_count never becomes a zero-row denial', () => {
  assert.throws(() => observe(raw, { rowCount: null, before, after: before }),
    /baseline_rollback_authenticated_raw_write_not_denied/);
});
test('a 42501 receipt cannot conceal a changed target', () => {
  assert.throws(() => observe(raw, { error: denied, before, after: changed }),
    /baseline_rollback_authenticated_raw_write_changed_target/);
});
test('a 42501 receipt cannot qualify a missing target', () => {
  assert.throws(() => observe(raw, { error: denied, before: null, after: null }),
    /baseline_rollback_authenticated_raw_write_target_not_visible/);
});
test('an unexpected P0001 is propagated rather than accepted as a denial', () => {
  const failure = { code: 'P0001', message: 'controlled unknown failure' };
  assert.throws(() => observe(raw, { error: failure, before, after: before }), (error) => error === failure);
});

test('all prior proof statements remain byte-exact after removing only the bounded correction', () => {
  let old = proof.replace(/-- BEGIN_BASELINE_RAW_READ_ONLY_MEMBERSHIP\n[\s\S]*?-- END_BASELINE_RAW_READ_ONLY_MEMBERSHIP\n/g, '');
  old = old.replace(/-- BEGIN_BASELINE_RAW_MEMBERSHIP_RESTORE\n[\s\S]*?-- END_BASELINE_RAW_MEMBERSHIP_RESTORE\n/g, '');
  const oldRaw = originalRaw;
  old = old.replace('do $old_authenticated_raw_write_denial$\n' + raw + '\n$old_authenticated_raw_write_denial$;',
    'do $old_authenticated_raw_write_denial$\n' + oldRaw + '\n$old_authenticated_raw_write_denial$;');
  assert.equal(createHash('sha256').update(old).digest('hex'),
    '051a7a739f01166aa3e415c491160aecac2537c25a39cae323c8fbd804fcc3d9');
});
