# Override Protocol

Cursor may override an existing rule, pattern or approved assumption only when there is strong evidence that it is wrong, incomplete, unsafe or blocking correct production behavior.

## Before overriding

Document:

1. Existing rule/pattern
2. Why it is wrong or incomplete
3. Evidence from:
   - code
   - database schema
   - EDIFACT payload
   - Ediel test result
   - runtime error
   - build/type error
   - official implementation requirement
4. Files that must change
5. Regression risks
6. Validation steps

## During override

- Keep the change minimal.
- Do not use hardcoded one-off values unless explicitly required and documented as configuration.
- Preserve unrelated approved flows.
- Update tests/guards where possible.

## After override

Update:

- relevant ai-context MD file
- 10_CHANGELOG.md
- 11_CURRENT_TASK.md

Return:

- what rule changed
- why
- what files changed
- what validation was run
- what risks remain
