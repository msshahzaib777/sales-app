# Progress

Running log of what has been built, decisions taken, and open items. Newest first.

## Task 2 follow-up: discount slabs — done

- Owner's answers recorded in SPEC §17: discounts are a fixed PKR amount per dozen with quantity
  slabs per product; damage claims are refunded at purchase cost only (already the default).
- New migration `product_discount_tiers`: `ProductDiscountTier` table (with a CHECK constraint)
  and a `discountTiers` snapshot column on `ProductPriceHistory`.
- `resolveDiscount()` in `src/server/services/pricing.ts` picks the slab for a line, with tests.
- Seed now uses per-dozen discounts, has slabs on 5 products, and books a wholesale order
  (30 dz and 25 dz lines) that reaches them.

## Task 2: Database schema — done

**Built**

- Full Phase 1 Prisma schema (`prisma/schema.prisma`, 31 tables) and migration
  `20261024015028_phase1_schema`: platform (Tenant, User, AuditLog, DocumentSequence), master data,
  purchasing, inventory, sales, payments and the ledger.
- Hand-written SQL at the end of that migration for rules Prisma cannot express: CHECK
  constraints, append-only triggers and one partial unique index (details below). Prisma does not
  track these, and a test migration confirmed it will not try to drop them later.
- `src/server/services/pricing.ts`: line amounts (gross, discount, tax, net) with exact decimal
  rounding, plus unit tests. The seed uses it now and order entry (Task 6) will reuse it.
- `src/server/auth/password.ts`: scrypt password hashing from Node's built-in `crypto` (no new
  dependency), with tests. The seed uses it for demo logins; Auth.js (Task 3) will verify with it.
- Realistic seed (`pnpm db:seed`): 2 warehouses, 3 companies, 20 products with price history,
  5 areas, 30 customers, 5 staff, 4 bikes, opening balances, one received purchase order per
  company (batches, stock and company bill), one company payment, one delivered order with bill,
  revision, cash payment split by company and a damage claim, 12 booked orders for tomorrow, and a
  pending stock adjustment. Demo logins (password `Demo@12345`): `owner@demo.test`,
  `accountant@demo.test`, `staff@demo.test`, `admin@platform.test` (super admin).
- Scripts: `db:migrate` now also regenerates the client (Prisma 7 no longer does this
  automatically); new `db:reset` drops the database, re-applies migrations and seeds.

**Verified:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (14 tests), `pnpm build`, and
`prisma migrate deploy` + `pnpm db:seed` on a fresh database. I also ran these checks directly in
SQL:

- UPDATE, DELETE and TRUNCATE on the journals are rejected.
- A customer ledger entry without `companyId` is rejected, and so is an entry with both debit and
  credit.
- A row that points at another tenant's product is rejected.
- A zero-quantity stock movement is rejected.
- A bill's total equals its ledger debits.

### Design choices that are not obvious

1. **Cross-tenant safety in the database.** Every business table has `@@unique([tenantId, id])`, and
   every reference between business tables is a composite foreign key on `(tenantId, xId)`. The
   database itself therefore refuses a row whose product, customer, etc. belongs to another
   tenant, even if application code has a bug. This is a step towards SPEC §12's "enforced at the
   database level"; Postgres row-level security can be added on top later. One side effect: Prisma
   nested `connect` writes don't work on these relations, so services write scalar ids
   (`productId: …`), which is what the tenant data layer will do anyway. The `[tenantId, id]` unique
   index also serves as the `tenantId` index for each table.
2. **Append-only journals are enforced by triggers.** `StockMovement`, `LedgerEntry`, `AuditLog`,
   `ProductPriceHistory` and `BillRevision` reject UPDATE, DELETE and TRUNCATE. Corrections are new
   rows; `reversalOfId` (unique) links a reversal to the original, so nothing can be reversed twice.
   Because of this, the seed only runs on an empty demo tenant; `pnpm db:reset` starts over.
3. **Ledger sign convention.** Balance = `SUM(debit − credit)` per party.
   - Customer: a bill is a debit and a payment is a credit, so a positive balance means they owe us.
   - Company: a company bill is a credit, and payments and claims are debits, so a negative balance
     means we owe them.
   - Staff: advances and cash shorts will be debits; salary will be a credit.
     CHECK constraints make every entry one-sided and non-negative, and require the right party
     columns. A CUSTOMER entry must carry both `customerId` and `companyId` (CLAUDE.md rule 3), so
     "customer × company" and "company × all customers" are plain filtered sums.
4. **Opening balances are ledger entries, not columns.** Company and customer (per company)
   opening balances are `OPENING_BALANCE` ledger rows, so every balance comes from the journal.
   The master-data screens (Task 4) create these rows.
5. **Units and rates.** Quantities are integers in the product's `baseUnit` (`HALF_DOZEN`). Rates
   are per `priceUnit` (`DOZEN`). `UnitConversion` says how many base units a unit holds:
   - `productId = null` rows are the tenant's defaults (DOZEN = 2 HALF_DOZEN).
   - A product row overrides the default, which is how cartons and pieces will be added later.
   - A partial unique index keeps the tenant defaults unique.
     Rates are stored per dozen rather than per half dozen to avoid sub-paisa rates.
     `Bike.capacity` and `Product.minStockLevel` are also in base units.
6. **Company discount: fixed PKR per dozen, with quantity slabs.** (Confirmed by the owner; see
   SPEC §17.)
   - The product's base discount is `discountType` + `discountValue`. The first tenant uses
     `AMOUNT_PER_UNIT` (PKR per dozen); `PERCENT` is kept for other tenants.
   - `ProductDiscountTier` rows add slabs, e.g. "from 25 dozen: Rs 15 per dozen".
   - The highest slab a line reaches replaces the base discount for the whole line. Slabs are counted
     per product line, not across a company's products in the order.
   - `ProductPriceHistory.discountTiers` snapshots the slabs with every rate change, so slab changes
     keep their history too.
   - Order lines snapshot the discount that actually applied, plus the computed amounts.
   - Pricing rounds each component to paisa (half up), so line totals always add up exactly to bill
     totals.
7. **Stock buckets instead of a separate damaged-stock table.** `StockMovement.bucket` is `SALEABLE`
   or `DAMAGED`. Delivery damage is `+DAMAGED`, because the saleable stock already left at dispatch.
   A return to the company is `−DAMAGED`. Batch quantity is not stored: it is the sum of movements
   with that `batchId`. Reserved stock is not a movement; it is derived from lines of BOOKED or
   PLANNED orders (available = on hand − reserved).
8. **Status is derived, not stored, where it would duplicate the journals.** A company bill's paid,
   partial, unpaid or overdue status comes from `netAmount`, its allocations and `dueDate`. Bills,
   payments and company bills only store `POSTED | REVERSED`.
9. **Company claims post to the ledger when logged.** The debit hits the company ledger
   immediately. `appliedToBillId` and `CompanyBill.claimDeduction` record which bill deducted the
   claim, for printing and payment matching. Claims are valued at purchase cost only (confirmed by
   the owner; SPEC §17).
10. **Bills.** There is one `Bill` per sales order, and its totals reflect the current revision.
    - Each revision is an immutable `BillRevision` holding JSON snapshots of the printed lines and
      the per-company totals, so old printouts can be reproduced exactly.
    - `previousBalance` is snapshotted on the bill for printing.
    - `SalesOrderLine.companyId` is copied from the product so splitting a bill by company needs
      no join and stays correct even if a product moves to another company.
11. **One `Cheque` table for both directions** (`RECEIVED` from customers, `ISSUED` to companies),
    linked one-to-one from `CustomerPayment` or `CompanyPayment`. `CompanyPaymentAllocation` was
    added (not in the task list) because company payments can settle several bills.
12. **Document numbers** (`number`) are unique per tenant and come from `DocumentSequence`. Services
    should increment it with `UPDATE … RETURNING` inside the posting transaction so concurrent
    posts never collide.
13. **Idempotency.** Every create/post document (purchase order, goods receipt, company payment,
    claim, stock adjustment, sales order, customer payment) has `requestId` with a unique
    `(tenantId, requestId)` index. A retried request hits the unique index instead of creating a
    duplicate.
14. **Who did it.** `createdById`-style columns are plain user ids without foreign keys, to avoid
    a dozen back-relations on `User`. `AuditLog` (with a real FK) is the authoritative record of
    who changed what. `User.tenantId` is null only for SUPER_ADMIN, and email is globally unique
    for login.
15. **Dates.** Business dates (order, bill, due, ledger entry) are `@db.Date` in tenant-local
    (PKT) terms. Event times are timestamps.
16. **Future-proofing kept but unused:** `Batch.batchNo / mfgDate / expiryDate`,
    `Product.taxRate`, line and bill `taxAmount`, `Tenant.taxEnabled / expiryTrackingEnabled`, and
    `SalesOrder.source`.

**Open / next**

- When a sales order gets its bill (at booking or at dispatch) is a Task 6 decision. The seed
  only bills the delivered order.
- The seeded delivery damage creates a claim but does not revise the bill; the full day-end flow
  is Task 8.
- Phase 2 entities (delivery plans/trips, expenses, payroll, notifications) and staff-ledger entry
  types are not in this schema yet; they will be added by later migrations.
- Postgres row-level security is not set up yet; consider it with or after the tenant data layer
  (Task 3).

## Task 1: Project setup — done

**Built**

- Next.js 16 (App Router) + TypeScript strict, pnpm 10, Tailwind CSS 4.
- shadcn/ui configured by hand (`components.json`, theme tokens in `src/app/globals.css`, `cn`
  helper in `src/lib/utils.ts`, `Button` component), because the shadcn registry was unreachable
  from the build environment. The CLI works for adding more components on a normal network.
- Prisma 7 with PostgreSQL through the `@prisma/adapter-pg` driver adapter. Config lives in
  `prisma.config.ts`; the client is generated to `src/generated/prisma` (git-ignored, regenerated
  on `pnpm install`). The raw client in `src/server/db/client.ts` is marked `server-only`.
- Bootstrap schema with only a `Tenant` table and an `init` migration, plus a seed script that
  upserts a demo tenant. The full Phase 1 schema comes in Task 2.
- Zod installed (used from Task 2 onward).
- Vitest with `@/` path aliases; first unit tests cover half-dozen quantity conversion
  (`src/lib/units.ts`).
- ESLint (Next.js core-web-vitals + TypeScript) with `eslint-config-prettier`; Prettier with the
  Tailwind class-sorting plugin. Spec documents and `CLAUDE.md` are excluded from Prettier.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `format`, `db:migrate`,
  `db:deploy`, `db:seed`, `db:generate`, `db:studio`.
- App shell: left sidebar (Dashboard, Orders, Delivery, Purchases, Inventory, Customers,
  Companies, Payments, Expenses, Reports, Settings) with active-link highlighting; `/` redirects
  to `/dashboard`; each section has an empty placeholder page. Pages are server components; only
  the nav list is a small client component (for the active link). The sidebar is hidden when
  printing.
- README with local setup steps, and `.env.example`.

**Verified:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:migrate` and
`pnpm db:seed` pass against a local PostgreSQL 16.

**Open / next**

- Task 2: full Prisma schema and realistic seed (2 warehouses, 3 companies, 20 products,
  30 customers, 4 bikes).
- Task 3: Auth.js login, `src/server/db/tenant.ts` tenant-scoped data layer, permissions, audit
  log helper. Pages are not protected until then.
- Playwright is not installed yet; add it with the first key flow (login / order entry).
- No CI workflow yet; consider a GitHub Action running lint, typecheck and test.
