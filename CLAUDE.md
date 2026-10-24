# Taqseem — project brief for Claude Code

The product is called **Taqseem** (Urdu for *distribution*); show it through `APP_NAME` in
`src/lib/brand.ts`. Code, database and repository names keep the working name `sales-app` /
`sales_app`.

Multi-tenant SaaS for product distributors (first tenant: a snack distributor in Pakistan).
The full requirements are in `docs/SPEC.md`. Read the relevant section before starting any task.

## Stack
- Next.js (App Router) + TypeScript (strict)
- PostgreSQL + Prisma ORM
- Auth: Auth.js (credentials login, email + password)
- UI: Tailwind CSS + shadcn/ui
- Validation: Zod (shared between forms and server actions)
- Tests: Vitest for business logic, Playwright for key flows
- Package manager: pnpm
- Hosting target: Vercel + managed Postgres (Neon or Supabase)

## Architecture rules (do not break these)
1. **Multi-tenancy:** every business table has `tenantId`. All queries go through a tenant-scoped
   data layer (`src/server/db/tenant.ts`) that injects `tenantId` from the session. Never query
   business tables with the raw Prisma client in route handlers or components.
2. **Two append-only journals are the source of truth:**
   - `StockMovement` for stock (balance = sum of movements per product per warehouse).
   - `LedgerEntry` for money (customer, company and staff balances = sum of entries).
   Posted entries are never edited or deleted; corrections are reversal entries.
3. **Customer ledger entries always store `companyId`**, so we can show a customer's ledger
   for all companies or for one company. *Approved exception:* the customer's **old balance**
   (`CustomerOldBill`, unpaid paper bills from before the app, owed to us and not to a company)
   posts with `companyId` null, as do payments, bounces and reversals that settle it. It counts in
   the customer's total, shows as "Old balance", is paid first and is left out of every company
   figure. A DB CHECK allows null only for those entry types.
4. **Quantities** are stored as integers in the smallest unit (half dozen). Convert to dozens
   only for display. Keep a `UnitConversion` table so cartons/pieces can be added later.
5. **Money** uses `Decimal` (Prisma `Decimal @db.Decimal(14,2)`), never JS floats for storage.
   Currency is PKR.
6. **Audit log:** every create/update/delete on orders, bills, payments, stock, rates and
   master data writes an `AuditLog` row (user, time, entity, old value, new value).
7. **Idempotency:** create/post actions accept a client-generated `requestId` so retries on
   weak internet never create duplicate orders or payments.
8. **Roles:** SUPER_ADMIN (platform), OWNER, ACCOUNTANT, STAFF. Check permissions on the server,
   not only in the UI. Staff must never see profit, margin or purchase-cost figures.
9. **Future-proofing:** `Batch` has optional `batchNo`, `mfgDate`, `expiryDate` (unused for now).
   Tax fields exist but are off. `SalesOrder.source` = OFFICE | WHATSAPP | BOOKER_APP.

## Domain glossary
- **Company** = supplier whose products we distribute. Each product belongs to one company.
  Each company belongs to one warehouse.
- **Customer** = retailer, wholesaler, dealer or bike supplier who buys from us.
- **Order booker** = company's person who reports next-day orders; does not log in.
- **Company bill** = what we owe a company for a goods receipt; has a due date.
- **Bill** = our bill to a customer; one bill can contain products from several companies.
- **Damage claim** = items damaged during our delivery; charged back to the company.
- **Day-end reconciliation** = entering delivery results and cash from signed bills after
  drivers return.

## UX rules
- Office desktop users, often on slow internet: keep pages light, use server components,
  avoid heavy client libraries.
- Keyboard-first data entry on order and payment screens.
- Every list: search, filters, date range. Every report: print + PDF + Excel export.
- Printed bills default to A5 on a normal printer; layout must work in black and white.

## Working conventions
- Small, focused commits. One feature per branch/PR.
- Business logic lives in `src/server/services/*` with unit tests; UI calls services via
  server actions.
- Seed script (`pnpm db:seed`) creates a demo tenant with 2 warehouses, 3 companies,
  20 products, 30 customers, 4 bikes, so every feature can be tried immediately.
- Before finishing a task: run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and fix failures.
- Update `docs/PROGRESS.md` with what was built and anything left open.
