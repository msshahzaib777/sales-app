# Progress

Running log of what has been built, decisions taken, and open items. Newest first.

## Task 5: Purchasing and company ledger — done

**Built** (all under **Purchases**, with tabs; services in `src/server/services/purchasing/`)

- **Purchase orders:**
  - create by typing quantities (dozens) against the company's product list;
  - edit or cancel while nothing has been received; close a partly received order once the rest
    won't come;
  - the order page shows ordered vs received per product (+2 dz over, −2 dz short): the variance
    report from SPEC §4;
  - status is Open → Partly received → Received (or Closed / Cancelled).
- **Goods receipts:**
  - from a purchase order (remaining quantities pre-filled) or without one; received quantities
    can be less or more than ordered;
  - posting, in one transaction: saves the receipt, adds a **batch** and a `GOODS_RECEIPT` **stock
    movement** per line, creates the **company bill** at the purchase rate with **due date =
    received date + payment terms** (owner/accountant may type another), **deducts pending
    damage claims**, **credits the company ledger**, and updates the purchase order's status;
  - a mistaken receipt can be **cancelled by reversal** (owner only, with a reason): mirror stock
    movements, a reversing ledger entry, bill marked cancelled, claims back to pending. It is
    refused once any of that stock was used or anything was paid on the bill.
- **Company bills:**
  - paid / partial / unpaid / overdue with "due N days ago" (derived, never stored);
  - list filters for open, overdue, paid, company and date range, with outstanding and overdue
    totals;
  - the bill page shows lines, claims deducted, payments and a due-date change (audited).
- **Company payments:**
  - cash, cheque (number, bank, date) or online (reference); full, partial or more than owed
    (the rest is kept as an advance);
  - applied to the **oldest due bills first** by default, or split by hand ("Choose bills", with
    a "Fill oldest first" helper);
  - a payment can be **reversed** with a reason (mistake or bounced cheque), which makes its bills
    unpaid again.
- **Damage claims:**
  - a credit against the company at purchase cost (owner's answer), debited to the ledger when
    logged, and **deducted on the company's next bill**;
  - pending claims can be cancelled (by reversal).
- **Company ledger** (`/companies/[id]/ledger`, linked from the Payable column on Companies):
  - every bill, payment, claim, opening balance and reversal with a running "we owe" balance;
  - date range (default: 1st of last month to today) with the opening balance brought forward;
  - summary (we owe now, open bills, overdue, claims waiting) and bill-wise status;
  - **Print / PDF** (print layout) and **Download Excel** (.xlsx).
- **Permissions:**
  - staff can create purchase orders and receive goods, but never see rates, amounts or bills
    (purchase cost), and their rates/due dates are ignored;
  - bills, payments, claims and ledgers are for owner and accountant;
  - cancelling a receipt needs the new owner-only `documents.reverse` permission.
- **Every post and reversal is audited; every create takes a `requestId`** (idempotent).

**Tests:** 142 in total.

- Unit (`calc.test.ts`): oldest-first allocation, manual allocation checks, bill status and
  days overdue, claim deduction, purchase order status, running balance.
- Integration (`purchasing.int.test.ts`, 22 tests):
  - receipts: stock, batches, bills and due dates;
  - staff can't set rates or due dates;
  - claims deducted on the next bill;
  - payments: auto/manual/advance, reversal;
  - receipt cancellation and its guards;
  - document numbering, idempotency, cross-tenant attempts;
  - the ledger, plus an invariant check: ledger balance = open bills − pending claims − advances.
- Browser run of the production build covering:
  - owner PO → staff receipt with over/under delivery;
  - claim deducted on the next bill;
  - manual payment split;
  - ledger and Excel download;
  - payment reversal and receipt cancellation;
  - the staff view.

### Design choices that are not obvious

1. **The opening balance is a bill.** A company's opening balance is a `CompanyBill` of kind
   `OPENING_BALANCE`, kept equal to the opening balance, due on the date it was entered. Without
   it, payments "oldest first" skipped the oldest debt (found in browser testing: the ledger
   showed 185,000 more owed than the open bills).
   - The opening balance can't be lowered below what was already paid against it.
   - A migration created these bills for existing data.
   - Customer opening balances (Task 9) should get the same treatment.
2. **The ledger is credited with the bill's gross amount, not the net.** Claims are already debited
   when logged, so the deduction on the bill is only for matching. Ledger balance = open bills −
   pending claims − unallocated payments (tested).
3. **Claims are applied whole, oldest first, never more than the bill.** A claim bigger than the bill
   waits for the next one. Claims do not move stock here; damaged stock movements come with
   day-end reconciliation (Task 8).
4. **Receipt posting and payments run in serializable transactions.** Two at once can't deduct
   the same claim or over-pay the same bill; Postgres aborts one, and a retry is harmless thanks
   to `requestId`.
5. **Document numbers** come from `DocumentSequence` via an upsert-increment inside the posting
   transaction (row-locked until commit).
6. **Staff and rates.** Staff purchase orders and receipts are priced at the PO line rate or
   the product's purchase rate. The rate inputs are not even sent to their browser.
7. **Reversals.** Reversal ledger entries are type `REVERSAL` with `reversalOfId` (unique, so
   nothing is reversed twice). Bill and payment rows keep their history with status `REVERSED`.

**Open / next**

- Damaged stock returned to the company is logged as a claim type, but the stock movement
  (−damaged stock) comes with Task 8 / inventory.
- Cheque clearing for issued cheques (pending → cleared) is Phase 2 cheque tracking; cheques are
  recorded now.
- A company-wide "ordered vs received" report across purchase orders (SPEC §4 reports) can join
  the Reports section in Phase 3; per order it's on the order page now.
- The daily owner report listing overdue bills comes with the dashboard (Phase 3); the overdue
  filter and "due N days ago" already exist.

## Task 4: Master data screens — done

**Built**

- **List, create and edit screens** for:
  - Customers, Companies and Products (in the sidebar);
  - Warehouses, Areas / routes, Delivery bikes and Staff (under Settings).
- **Lists:** search, filters (status plus per-list filters such as company, area, type, warehouse,
  role) and pagination (50 per page). Filters are a plain GET form, so they work without
  JavaScript and stay in the URL.
- **Forms:** one shared, keyboard-first form (`src/components/master/record-form.tsx`). The first
  field gets focus and Enter saves. New records also get "Save and add another". Validation
  errors show under each field and keep what was typed.
- **Companies:** warehouse, contact, order booker name and phone, payment terms in days, and an
  opening balance.
- **Products:**
  - purchase and sale rate per dozen, minimum stock in dozens;
  - company discount (Rs per dozen, percent, or none) plus up to 10 quantity slabs;
  - every change to rates, discount or slabs appends a `ProductPriceHistory` row with its
    effective date, shown on the product page. Name or stock changes don't.
- **Customers:** type, area and visiting order, credit limit (blank = no limit), and an opening
  balance per company. The list shows each customer's current balance.
- **Bikes:** capacity in dozens, warehouse, and a driver chosen from active staff with the Driver
  role.
- **Deactivate instead of delete.** Every record can be deactivated or reactivated. Delete is
  offered, but the database refuses it once the record is referenced (ledger entries, price
  history, orders, …), and the user is told to deactivate instead. Products always have price
  history, so they show no Delete button. Deactivated records drop out of pick lists, but an edit
  form keeps the record's current choice selectable.
- **Excel/CSV import** for products and customers (`/products/import`, `/customers/import`):
  - **Upload:** .xlsx (first sheet) or .csv, up to 2 MB and 2,000 rows. There's a downloadable
    template; the customer template has one "Opening: <company>" column per company.
  - **Check file:** shows every row as New / Update / Error with readable messages. Nothing is
    saved at this step. "Download error report" exports the bad rows as a CSV.
  - **Import:** the server re-reads and re-validates the file, then saves the valid rows in one
    transaction. Error rows are skipped.
  - **Products:** an existing code updates that product (new rates go into price history).
  - **Customers:** create only; a name + phone that already exists is reported as a duplicate.
- **Permissions:**
  - Everyone can view Customers, Companies and Products, which order entry needs.
  - Creating, editing, deactivating and importing need `masterData.manage` (owner), and rate
    changes also need `rates.manage`.
  - Staff never see purchase rates (the service removes them) or company payables.
- **Audit:** every create, update, deactivate, delete and import row writes an audit entry with old
  and new values (changed fields only).
- **Idempotency:** master tables gained `requestId` (unique per tenant). A retried Save returns the
  record already created; import rows use `<importId>:<row>`.

**Tests:** 108 in total.

- Unit tests: validation (money, half dozens, slabs, defaults), CSV and .xlsx reading
  (including restoring leading zeros on phone numbers), import row validation, formatting.
- Integration tests:
  - idempotent creates and duplicate messages;
  - price history only on rate changes;
  - purchase rates hidden from staff, and owner-only editing;
  - opening balances posting only the difference;
  - delete-versus-deactivate rules;
  - drivers on bikes;
  - cross-tenant attempts;
  - import preview and commit.
- Browser run of the production build covering:
  - forms: duplicate name, a validation error that keeps typed values, three "Save and add
    another" customers in a row;
  - records: product slabs and price history, customer opening balance, deactivate and delete;
  - customer import with an error report;
  - the staff view.

### Design choices that are not obvious

1. **Opening balances post the difference.** Changing a customer's or company's opening balance
   adds an `OPENING_BALANCE` ledger entry for the difference (e.g. 5,000 → 4,000 posts a 1,000
   credit), so the ledger stays append-only and every change is visible. A customer's opening
   balance can be negative (an advance).
2. **Slabs use the base discount's unit:** Rs per dozen, or percent if the base is percent. A zero
   discount with no slabs is stored as "no discount".
3. **Delete is decided by the database.** Delete attempts the deletion and turns a
   foreign-key/append-only refusal into "deactivate instead". This stays correct as later tasks
   add more tables that reference master data, with no "is it used?" lists to maintain.
4. **Changing a company's warehouse, or a product's company, is blocked once there are purchases,
   stock or orders.** Moving them would mix stock between warehouses.
5. **Request ids for new records are created in the browser on the first Save** and reused on
   retries. After "Save and add another" the page redirects with the new record's id, which gives
   the next blank form a fresh id.
6. **Customer import area names must be unique.** An area name used in two warehouses is reported
   as unknown rather than guessed.
7. **Master-data lists have no date-range filter.** CLAUDE.md asks for one on every list, but it
   isn't meaningful for master records; it will be on transaction lists and reports.

**Also fixed**

- Session reads now call `connection()`. Auth.js re-encrypts the session cookie with random bytes,
  which Next.js flagged during prerendering; the server log is now clean.
- The sidebar's active-page highlight now loads with the session. Dynamic routes like
  `/customers/[id]` can't read the URL at build time.
- ESLint allows `_`-prefixed unused names (used to drop fields from objects).

**Open / next**

- Visiting order is a number on each customer; a drag-to-reorder route screen can come with
  delivery planning (Phase 2).
- Slabs can't be imported yet; they're added on the product page.
- `UnitConversion` (cartons/pieces) has no screen yet; only the half dozen / dozen defaults exist.

## Task 3: Auth, tenants and roles — done

**Built**

- **Login** with Auth.js v5 (credentials, JWT sessions): `src/auth.ts`, login page `/login`, sign out
  in the sidebar.
  - The token holds only the user id and a session version. Every request re-reads the user from
    the database (`src/server/auth/session.ts`), so role changes, deactivation, password resets
    and a suspended tenant take effect immediately.
  - Sessions end after 8 hours without activity.
  - Wrong-password responses take the same time whether or not the email exists.
- **Tenant-scoped data layer** (`src/server/db/tenant.ts`).
  - `createTenantDb(tenantId)` adds `tenantId` to every Prisma operation: filters, unique lookups,
    creates, upserts and updates. It refuses another tenant's id and blocks raw SQL, including
    inside transactions.
  - App code gets it through `requireTenantContext(permission?)`, which takes the tenant from the
    session.
  - A unit test fails if a model with `tenantId` is added to the schema without being registered.
- **Permissions** (`src/server/auth/permissions.ts`): a role → permission table plus `can` and
  `assertCan`, checked in services and server actions.
  - Staff never get `financials.view` (profit, margin, purchase cost), `ledgers.view` or
    `rates.manage`.
  - Owner only: users, settings, stock-adjustment approval, credit-limit override, audit log.
  - The sidebar hides items the role can't use, and pages check again on the server
    (`RequirePermission`).
- **Users page** (`/settings/users`, owner only): add a user, change role, deactivate or reactivate,
  reset password.
  - There's no email yet, so adding a user creates a one-time temporary password (shown once, with
    "Copy for WhatsApp"). The user must choose their own password at first sign-in
    (`/account/password`).
  - Owners can't change their own role or deactivate themselves. The last active owner can't be
    removed; these checks run in serializable transactions so two owners can't race.
- **Audit log helper** (`src/server/audit.ts`): `writeAudit(tx, user, {...})` runs inside the same
  transaction as the change. It strips secrets (password hashes, tokens) and turns Decimals and
  dates into strings. User changes and sign-ins are audited.
  **Rule from now on: every mutation calls `writeAudit` in its transaction.**
- **Server-action helpers.** `runAction()` (`src/server/actions.ts`) turns validation, permission and
  business-rule errors into form messages and re-shows what the user typed (never passwords).
  Shared Zod schemas live in `src/lib/validation/*`.
- **Super admin** signs in to a placeholder `/admin` (the panel comes in Phase 5) and cannot open
  tenant pages.
- **Schema:** `User.mustChangePassword`, `User.sessionVersion`, and `Staff.userId` is now a
  tenant-checked composite foreign key (two migrations).

**Tests:** 72 in total.

- Unit tests: permissions, scoping rules, audit sanitising, password policy, temporary passwords,
  form helpers.
- Integration tests run against a real Postgres test database (`TEST_DATABASE_URL`):
  - `src/server/db/tenant.int.test.ts` proves tenant A can never read or change tenant B's data,
    for every kind of operation: findMany, findFirst, findUnique by id and compound key, count,
    aggregate, groupBy, includes, update, updateMany, delete, deleteMany, upsert, create and
    nested create, raw SQL and transactions. It also shows that the database refuses cross-tenant
    references.
  - `src/server/services/users.int.test.ts` covers invites, roles, deactivation, resets, the
    last-owner rule, cross-tenant user management and login.
- Browser check of the production build (Playwright, run by hand):
  - login, wrong password, invite, first-login password change;
  - staff menus and "No access" pages;
  - deactivation ending an open session immediately;
  - sign out, and the super admin redirect;
  - on a shared PC, the next user never sees the previous user's cached pages.

### Design choices that are not obvious

1. **Services pass `tenantId` in create data.** Prisma's generated types still require it, and
   making them optional would take fragile type-level tricks. The data layer checks that it equals
   the session's tenant and refuses anything else. So write
   `tx.customer.create({ data: { tenantId: ctx.user.tenantId, ... } })`. Nested creates inherit it
   automatically.
2. **Next.js 16 Cache Components is on.** A page that reads the session must sit inside a
   `<Suspense>` boundary. The `(app)` layout already wraps every page in one, after a session
   check, so pages can call `requireTenantContext()` directly. The sidebar is part of the static
   shell and loads instantly.
3. **Sign-in and sign-out do a full page load** (`window.location.assign`) instead of a client-side
   navigation. This throws away Next's client cache, so a cached page or redirect from one user
   can never show to the next user on a shared office PC (found and fixed during browser testing).
4. **After a password change the user signs in again.** Changing a password bumps
   `sessionVersion`, which ends every session, including the current one. Re-issuing a session
   inside the same action proved unreliable with Auth.js: its session read re-wrote the old cookie
   after the new one. One extra sign-in is simple and predictable.
5. **Pages use a "No access" message, not `forbidden()`**, because Next's `forbidden()` is still
   experimental.
6. **Email is globally unique** because login is by email alone. Adding a user with an email that
   is used in another tenant fails with "already in use". That reveals the email exists somewhere,
   which is acceptable for now.

**Open / next**

- Brute-force protection (rate limiting or lockout after failed sign-ins) is not built yet. Worth
  adding before the app is exposed publicly.
- Optional 2-step verification for owners (SPEC §13) is not built.
- Per-tenant configurable roles (SPEC §2) use a fixed role table for now.
- There are no Playwright tests in the repo yet. The browser checks above were run by hand; turn
  them into Playwright tests with the order-entry flow.
- CI is not set up (the workflow is ready to add once you say so). It should provide a
  `TEST_DATABASE_URL` Postgres service so the integration tests run.
- Postgres row-level security as a second layer is still open.

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
