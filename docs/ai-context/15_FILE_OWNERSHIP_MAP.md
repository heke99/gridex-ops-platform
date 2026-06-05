# File Ownership Map

This file should be updated over time.

Use it to avoid scanning the full repo.

## Ediel / EDIFACT

Likely files/directories:

- lib/ediel/**
- app/admin/ediel/**
- any ediel message actions/builders/parsers

## Routing / send / receive

Likely files/directories:

- lib/routes/**
- mail/imap/smtp related modules
- route decision engine
- communication route modules
- Ediel route profile modules

## Customers / onboarding

Likely files/directories:

- app/admin/customers/**
- customer server actions
- customer_sites
- metering_points
- powers_of_attorney
- supplier_switch_requests

## SaaS / tenant / RBAC

Likely files/directories:

- app/admin/companies/**
- auth helpers
- membership helpers
- server-side guards
- RLS migrations

## Billing/import/platform usage

Likely files/directories:

- billing underlay modules
- billing export modules
- import/upload modules
- meter/metering value modules
- platform billing/pricing modules
- usage statistics modules
- audit modules

## Database

Likely files/directories:

- supabase/migrations/**
- sql/**
- db helpers

## UI shared components

Likely files/directories:

- components/**
- app/admin/**
- app/layout files

## Rule

This map is guidance only. Inspect actual code before making changes.
