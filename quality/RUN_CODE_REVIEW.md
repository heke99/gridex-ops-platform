# Code Review Protocol: Gridex OPS remediation boundary

## Bootstrap (Read First)

Read quality/QUALITY.md, quality/REQUIREMENTS.md, quality/EXPLORATION.md, AGENTS.md, .agent-memory/core.md, docs/openapi/customer-portal-v1.json and the supplied 75-point specification. Review the focused files listed in quality/exploration_role_map.json. Evidence from current source and connected catalogs outranks memory.

## Pass 1: Structural Review

Read complete function bodies without using requirements as a checklist. Find only correctness defects: tenant predicate gaps, pre-pagination caps, off-by-one cursor logic, fail-open/fail-empty paths, non-atomic state transitions, unsafe public serialization, cross-tenant signature/reference behavior, stale read-before-check order, misleading status mapping and migration/catalog mismatch.

Every finding must cite exact file and line, show actual versus expected behavior, and be BUG, QUESTION or INCOMPLETE. Search the full codebase before claiming a behavior is missing. Do not report style or unmeasured optimization suggestions.

## Pass 2: Requirement Verification

Verify REQ-001 through REQ-012 independently of Pass 1. For each, record SATISFIED, VIOLATED, PARTIALLY SATISFIED or NOT ASSESSABLE; cite exact source/test/migration/live evidence and identify each unsatisfied condition. Dev evidence cannot satisfy production conditions in REQ-012.

## Pass 3: Cross-Requirement Consistency

At minimum compare these shared concepts against source:

| Concept | Requirements | Consistency question |
|---|---|---|
| public reference | REQ-001, REQ-003, REQ-007, REQ-008 | Is every output opaque and every lookup tenant-bound? |
| fail closed | REQ-004, REQ-008, REQ-012 | Can unavailable state become allow, empty or completion? |
| contract version | REQ-001, REQ-006, REQ-012 | Do runtime, OpenAPI, manifest, examples and provenance agree? |
| critical durability | REQ-005, REQ-010, REQ-011 | Can success precede required durable state? |
| caching/performance | REQ-006, REQ-009 | Are only immutable/public revision artifacts cached safely? |

Record CONSISTENT or INCONSISTENT with evidence from both locations and impact.

## Regression closure

Every confirmed BUG receives an executable Vitest regression in quality/test_regression.test.ts that asserts desired behavior and is guarded initially with test.fails naming the BUG and patch path. Temporarily remove the guard for the red run. If a reliable executable reproducer is impossible, provide an explicit exemption and minimal test design. Tests must call the exact cited path.

## Combined Summary

Write quality/code_reviews/2026-08-10-gridex-remediation.md with all three pass headings, a finding table, counts by severity and SHIP/FIX BEFORE MERGE/BLOCK. Add a REGRESSION TEST or EXEMPTION line for every BUG and update the cumulative tracker in quality/PROGRESS.md.
