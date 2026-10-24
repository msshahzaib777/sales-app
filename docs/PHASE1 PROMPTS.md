# Phase 1 prompts for Claude Code

Paste one task at a time into a Claude Code session on the `sales-app` repo.
Review and merge each result before starting the next task. Use Plan mode for tasks 1, 2 and 6.

---

## Task 1: Project setup
Read CLAUDE.md and docs/SPEC.md. Set up the project exactly as CLAUDE.md describes:
Next.js App Router + TypeScript strict, pnpm, Tailwind, shadcn/ui, Prisma with PostgreSQL,
Zod, Vitest, ESLint, Prettier. Add scripts: dev, build, lint, typecheck, test, db:migrate,
db:seed. Create a basic app layout with a left sidebar (Dashboard, Orders, Delivery, Purchases,
Inventory, Customers, Companies, Payments, Expenses, Reports, Settings) and empty pages.
Add a README with local setup steps and a .env.example. Create docs/PROGRESS.md.

## Task 2: Database schema
Read sections 3, 4, 5, 6, 8 and 15 of docs/SPEC.md. Design the full Prisma schema for Phase 1:
Tenant, User, Role enum, AuditLog, Warehouse, Company, Product, ProductPriceHistory,
UnitConversion, Customer, Area, Bike, Staff, PurchaseOrder(+Line), GoodsReceipt(+Line),
CompanyBill, CompanyPayment, CompanyClaim, Batch, StockMovement, StockAdjustment,
SalesOrder(+Line), Bill, BillRevision, CustomerPayment, PaymentAllocation, Cheque, LedgerEntry.
Follow every architecture rule in CLAUDE.md (tenantId everywhere, integer half-dozen quantities,
Decimal money, append-only journals, companyId on customer ledger entries).
Add indexes for tenantId and common lookups. Create the migration and a seed script with
realistic demo data. Explain any design choice that is not obvious in docs/PROGRESS.md.

## Task 3: Auth, tenants and roles
Implement login with Auth.js credentials. Each user belongs to one tenant and has a role
(OWNER, ACCOUNTANT, STAFF; SUPER_ADMIN is platform-level). Build the tenant-scoped data layer
in src/server/db/tenant.ts and a permission helper. Add an Owner-only Users page to invite
and manage staff. Write tests proving a user can never read another tenant's data.
Add the audit log helper and use it in every mutation from now on.

## Task 4: Master data screens
Build list + create/edit screens for Warehouses, Companies (with order booker name/phone and
payment terms), Products (purchase rate, sale rate, company discount, minimum stock, price
history on every rate change), Customers (type, area, credit limit, opening balance per
company), Areas, Bikes and Staff. Deactivate instead of delete once a record has transactions.
Add Excel/CSV import for products and customers with a preview and error report.

## Task 5: Purchasing and company ledger
Read section 4 of docs/SPEC.md. Build purchase orders, goods receipts (received qty can be less
or more than ordered), auto-created company bills with due dates, company payments (partial,
multi-bill, oldest-first allocation with manual override), and damage claims as credits.
Post stock movements and ledger entries through services with unit tests.
Build the company ledger screen with running balance and bill status (paid, partial, unpaid,
overdue, days overdue).

## Task 6: Sales orders and bills
Read section 6 of docs/SPEC.md. Build fast, keyboard-first order entry: pick customer (show total
pending, pending per company, credit limit), add products in dozens/half dozens with available
stock shown, auto-apply company discount, warn on credit limit (owner can override).
Statuses: Booked → Planned → Dispatched → Delivered / Partially delivered / Returned.
Booked orders reserve stock. One bill per order, viewable and printable split by company.
Bill shows previous pending, this bill and total due. Keep bill revisions.
Use the requestId idempotency rule from CLAUDE.md.

## Task 7: Bill printing
Build print layouts using print CSS: customer bill (full and split by company), customer
statement, company statement. Default A5, with tenant settings for A4, half-A4, A6, margins,
font size and "2 bills per A4". Show tenant name, logo and address when set, plain header
otherwise. Add "print all bills for selected orders".

## Task 8: Simple dispatch and day-end reconciliation
For Phase 1 (full planning comes in Phase 2): let staff assign orders to a bike and driver for
a date and mark them Dispatched (posts stock out). Build the day-end screen: per order, enter
delivered, returned and damaged quantities and cash/cheque/online collected. Returns go back to
stock, damage goes to damaged stock and creates a company claim, bills are revised
automatically, payments post to the customer ledger split by company.

## Task 9: Customer ledgers and payments
Read section 8 of docs/SPEC.md. Build customer payments at the office (cash, cheque with
status, online), oldest-first allocation split across companies, bounced cheque reversal.
Build ledger views: customer (all companies), customer × company, company (all customers),
with date range filter, print and PDF/Excel export.

## Task 10: Phase 1 review
Review the whole codebase against CLAUDE.md rules and Phase 1 of docs/SPEC.md. List anything
missing or inconsistent, fix bugs, add missing tests for stock and ledger calculations, and
update docs/PROGRESS.md with a Phase 1 completion checklist.
