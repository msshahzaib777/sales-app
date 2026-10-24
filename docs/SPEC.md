# Taqseem — Software Requirements Specification

Oct 24, 2026 · @Muhammad Laraib

## 1. Overview and scope

Taqseem (تقسیم, Urdu for *distribution*; working name "Sales App") is a web-based, multi-tenant distribution management system for distributors who buy products from supplier companies on credit, stock them in warehouses, and sell and deliver to about 200 customers per tenant. The first tenant is a snack distributor; the design must later support carton-based products with expiry dates.

The system replaces paper records and bill-only software with one place for orders, deliveries, stock, payments, ledgers, expenses and reports.

**In scope:** master data, purchasing and company ledger, inventory, sales orders and billing, delivery planning and reconciliation, customer payments and ledgers, expenses and payroll, reporting and dashboard, printing, WhatsApp notifications, and tenant subscription management.

**Out of scope for now:** driver mobile app, WhatsApp order taking, GPS tracking, offline mode, tax, customer-specific pricing, and online customer self-ordering.

**Business context (first tenant):**

| Item | Value |
| --- | --- |
| Product type | Snacks, counted in dozens and half dozens |
| Supplier companies | 1–20 per warehouse |
| Products | 15–50+ |
| Customers | About 200: retailers, wholesalers, dealers, bike suppliers |
| Warehouses | 2, each serving its own companies |
| Delivery bikes | 4, capacity 80–100 dozen each |
| Users | 1 office staff today; owner, accountant and data entry staff later |
| Language and currency | English, PKR |
| Usage | Office desktop, often on weak internet |

## 2. Users, roles and permissions

Only the distributor's own staff use the system. Company order bookers and delivery drivers do not log in; office staff enter their information.

| Role | Who | Can do |
| --- | --- | --- |
| Super admin | Software owner (you) | Manage tenants, subscriptions, usage, suspensions |
| Tenant admin | Distributor owner | Everything in the tenant, approve stock adjustments, see all financial reports |
| Accountant | Optional | Payments, ledgers, expenses, payroll, financial reports |
| Data entry staff | Office staff | Orders, purchases, deliveries, day-end entries; request stock adjustments; see operational reports only |

Rules:

- Owner sees profit and loss, net profit, margins and all financial reports.
- Staff see delivery, stock and product-demand reports, not profit figures.
- Stock adjustments by staff stay pending until the owner approves or rejects them.
- Roles are configurable per tenant, so a tenant can tick which modules and reports each role sees.
- Every create, edit and delete is logged with user, time, old value and new value.

## 3. Master data

All master records belong to one tenant, and can be deactivated instead of deleted once they have transactions.

| Record | Key fields | Notes |
| --- | --- | --- |
| Warehouse | Name, address | Stock and companies are separate per warehouse |
| Company | Name, warehouse, contact, order booker name and phone, payment terms (days), opening balance | Each company has its own booker |
| Product | Name, company, unit (dozen), purchase rate, sale rate, company discount (PKR per dozen, with quantity slabs), minimum stock level, active flag | One product belongs to one company; rate and discount changes keep history with effective date |
| Customer | Name, shop name, type (retailer, wholesaler, dealer, bike supplier), phone, WhatsApp, address, area/route, credit limit, opening balance per company | One sale rate for all customer types |
| Area / route | Name, warehouse, visiting order of customers | Replaces GPS for grouping deliveries |
| Delivery bike | Name or number, capacity in dozens, assigned driver | 4 bikes, 80–100 dozen |
| Staff | Name, role, phone, monthly salary, joining date | Drivers and office staff |
| Expense category | Name | Rent, salary, petrol, maintenance, utilities, labor; tenant can add more |

Quantities are stored internally in the smallest unit (half dozen), so dozens and half dozens never cause rounding errors.

## 4. Purchasing and company ledger

The distributor buys on credit: each received delivery creates a company bill with a due date, and the bill is paid in full or in parts later.

**Purchase order flow:**

1. Staff create a purchase order for a company with products, quantities and expected delivery date (ordered online or by phone outside the system).
2. When stock arrives, staff record a goods receipt with the received quantity per product. Received can be less or more than ordered.
3. The receipt creates a company bill for the received quantity at the purchase rate, and adds stock as a new batch.
4. Due date = receipt date + the company's payment terms, editable per bill.

**Company payments:** cash, cheque or online; full or partial; one payment can settle several bills, applied oldest first by default with manual override.

**Company credits that reduce the balance:**

- Damage claims: items damaged during delivery are logged against the company and deducted on its next bill.
- Returns of damaged stock sent back to the company.

**Company ledger:** running balance per company with every bill, payment, claim and adjustment; bill-wise status (paid, partial, unpaid, overdue). The daily report lists bills overdue, e.g. "due 5 days ago".

**Reports:** ordered vs received variance per purchase order and per company.

## 5. Inventory

Stock is tracked per product per warehouse, and every change is a stock movement with a reason, so the current balance can always be rebuilt from history.

| Movement | Effect on stock | Trigger |
| --- | --- | --- |
| Goods receipt | + | Company delivery recorded |
| Dispatch | − | Delivery plan confirmed and bikes loaded |
| Customer return at delivery | + | Day-end reconciliation |
| Damaged in delivery | moved to damaged stock | Day-end reconciliation; claim logged against the company |
| Damaged stock returned to company | − from damaged stock | Return note to company |
| Adjustment | + or − | Staff request, owner approval |

Rules:

- Booked orders reserve stock, so staff see "available = on hand − reserved" when taking orders; actual stock drops only at dispatch.
- Batches are kept as receipt lots with quantity only (no expiry for snacks); see section 14 for expiry later.
- Each product has a minimum stock level set by the owner.
- **Suggested order** per product = minimum level − available stock, rounded up to whole dozens, shown only when stock is below the minimum. A later option can use average daily sales instead.
- Adjustments need a reason (counting error, theft, other) and stay pending until the owner approves.

## 6. Sales orders and billing

Each company's order booker reports the next day's orders to the office, and staff enter them as sales orders for delivery the next day.

**Order entry:**

- Pick customer; the screen shows their total pending balance, pending per company and credit limit.
- Add products from any company in that warehouse, in dozens or half dozens; available stock shows beside each line.
- Sale rate comes from the product; the company's product discount is applied automatically and shown on the bill.
- Warn when the order would take the customer past their credit limit; the owner can allow it.
- Fast entry: keyboard-first, product search by name or short code, repeat the customer's last order.

**Order statuses:** Booked → Planned for delivery → Dispatched → Delivered, Partially delivered, or Returned. Orders can be edited until dispatch; after dispatch, changes happen only through day-end reconciliation, and all edits are logged.

**Billing:**

- One bill per customer order, even when it has products from several companies.
- The same bill can be viewed or printed split by company, and each company's portion posts to that company's slice of the customer ledger.
- The bill shows the previous pending balance, this bill, and total due.
- After delivery changes (returns, damage), the bill is revised automatically and the revision is kept.

## 7. Delivery planning and day-end reconciliation

Deliveries are planned the day before, dispatched in the morning, and confirmed or corrected when drivers return with signed bills.

**Planning (day before):**

1. The system lists all booked orders for tomorrow, grouped by area/route.
2. It suggests loads: fill each bike up to its capacity (80–100 dozen), keep nearby areas together, and use as few trips as possible. An order too big for one bike is split into partial loads.
3. Staff adjust by dragging orders between bikes and trips, and reorder stops.
4. Print per trip: a loading sheet (product totals to pick), the stop list in visiting order, and the customer bills.

**Dispatch:** confirming a trip deducts its stock and marks orders Dispatched.

**Day-end reconciliation (per driver, per trip):** staff enter from the signed bills, for each order:

- Delivered fully, partially, or refused.
- Returned quantity per product → back to stock.
- Damaged quantity per product → damaged stock and claim against the company.
- Cash, cheque or online amount collected.

The bill amount reduces automatically for returns and damage. The system then compares cash expected with cash handed in by the driver and records any **short or excess against that driver**, shown in the driver's ledger and the daily report.

Undelivered orders can be rescheduled to the next day's plan in one click.

## 8. Customer payments and ledgers

Customers usually pay the previous bill when the next order arrives, so the ledger runs as a running balance rather than strict bill-by-bill matching.

- **Payment methods:** cash, cheque (number, bank, date, status: pending, cleared, bounced), online transfer (reference).
- **Allocation:** a payment is applied to the oldest unpaid bill first; staff can override. When a payment covers a bill with several companies, it is split across companies in proportion to each company's unpaid amount, with manual override.
- **Bounced cheque:** reverses the payment, restores the balance, and flags the customer.
- **Payments recorded** at day-end (collected by driver) or at the office.

**Ledger views:**

| View | Shows |
| --- | --- |
| Customer, all companies | Every bill, payment, return and adjustment with running balance |
| Customer × company | The same, only for one company's products |
| Company, all customers | What all customers owe for that company's products |
| Ageing | Pending split into 0–7, 8–15, 16–30, 31–60 and 60+ days |

Each ledger can be filtered by date range, printed, exported to PDF or Excel, and sent to the customer on WhatsApp as a statement.

## 9. Expenses and payroll

Every expense is recorded with date, category, amount, payment method, warehouse and note, so daily and monthly costs feed straight into profit and loss.

- **Categories:** rent, salary, petrol, vehicle maintenance, utilities, loading labor, tolls, and any the tenant adds.
- **Petrol:** recorded per bike and per trip, so reports show fuel cost per trip, per bike and per dozen delivered.
- **Recurring expenses:** rent and similar can be set to post automatically each month.

**Payroll:**

- Fixed monthly salary per staff member.
- Advances given during the month, deducted from salary automatically.
- Incentives or bonuses added to salary.
- Driver cash short is deducted only if the owner chooses; excess can be returned or kept as a credit.
- Monthly salary sheet: base salary + incentives − advances − deductions = net paid, printable as a slip per staff member.
- Staff ledger shows salary, advances, cash short or excess and payments over time.

## 10. Reports and dashboard

Every report has a date picker with quick ranges (today, yesterday, this week, this month, custom), filters for warehouse, company, customer, area and driver, and export to PDF, Excel and print.

| Report | Audience | Contents |
| --- | --- | --- |
| Daily summary | Owner | Sales, collections, expenses, gross and net profit, cash in hand, overdue company bills |
| Profit and loss | Owner | Sales − purchase cost of goods sold − damage loss − expenses = net profit; by day, month, company, product |
| Daily expenses | Owner, accountant | Expenses by category, bike and trip |
| Customer pending | Owner, accountant | All-time pending per customer and per company, with ageing |
| Company pending | Owner, accountant | Amount owed per company, bills due and overdue |
| Driver cash reconciliation | Owner | Cash expected vs received, short or excess per driver |
| Inventory and suggested order | Owner, staff | Stock left per product, below-minimum items, suggested order quantities per company |
| Product demand | Owner, staff | Dozens sold per product, area and period; best and slow-moving items |
| Delivery performance | Owner, staff | Trips, dozens delivered, bike capacity used, returns and damage rates |
| Sales analysis | Owner | Sales by customer, customer type, area and company; top customers |
| Damage and claims | Owner, staff | Damaged quantity per company and product, claims pending adjustment |
| Audit log | Owner | Who changed what and when |

**Dashboard (owner):** today's sales, collections, expenses and net profit; total customer pending; total company payable; overdue company bills; low-stock products; tomorrow's planned trips. Each card links to its report, and a date range switch changes the whole dashboard.

**Dashboard (staff):** tomorrow's orders, delivery plan status, pending day-end reconciliation, low-stock products.

## 11. Printing and notifications

Bills print on a normal printer, not thermal, because signed bills are kept for weeks and thermal print fades.

**Printing:**

- Default paper size A5; tenant can choose A4, half-A4, A6 or a custom size, and set margins and font size to save paper.
- Option to print 2 bills per A4 sheet.
- Bill header shows the tenant's name, logo and address when set; without them it prints a plain header.
- Printable documents: customer bill (full or split by company), loading sheet, trip stop list, customer statement, company statement, salary slip, any report.
- Batch print all bills of a trip in one click.

**WhatsApp notifications (via the WhatsApp Business API):**

| Message | To | When |
| --- | --- | --- |
| Daily owner summary | Owner | Every evening at a set time |
| Overdue company bills | Owner | In the daily summary |
| Bill after delivery | Customer | After day-end reconciliation, optional |
| Statement or pending reminder | Customer | On demand or on a schedule |
| Low stock alert | Owner | When a product falls below minimum |

Email is offered as a fallback channel. The messaging layer is built so WhatsApp order taking can be added later.

## 12. Multi-tenant SaaS

One codebase serves many distributors, each with fully isolated data, sold on an annual subscription.

- **Tenant isolation:** every record carries a tenant ID enforced at the database level (e.g. row-level security), so one tenant can never see another's data.
- **Onboarding:** tenants can self sign up, or the super admin creates the account. The app can also be deployed as a separate instance for a tenant who wants it.
- **Setup wizard:** business name, logo, address, warehouses, companies, products, customers (bulk import from Excel), opening balances, bill paper size.
- **Subscription:** annual plan only; start and expiry dates, renewal reminders 30, 15 and 7 days before expiry, grace period, then read-only mode until renewal.
- **Super admin panel:** list tenants, create, suspend or reactivate, record subscription payments, see usage (users, customers, orders per month, storage), and log in as a tenant for support with an audit trail.
- **Per-tenant settings:** units in use, rounding, bill layout, report recipients, WhatsApp number, feature switches (e.g. expiry tracking).

## 13. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Ease of use | A new staff member can enter an order after 15 minutes of training; keyboard shortcuts; at most 3 clicks to any daily task |
| Weak internet | Light pages, cached master data, auto-save of draft forms, safe retry so a slow connection never creates duplicate orders or payments |
| Performance | Screens load in under 2 seconds on a 2 Mbps connection; reports for a year of data in under 5 seconds |
| Data safety | Daily automatic backups kept 30 days; tenant can export all their data |
| Security | Login with strong passwords, optional 2-step verification for owners, HTTPS, role-based access, session timeout |
| Audit | Every change to orders, bills, payments, stock and rates is logged and cannot be deleted |
| Accuracy | Money stored as exact decimals, never floating point; posted entries are reversed, never deleted |
| Devices | Desktop browsers first (Chrome, Edge); usable on tablets |
| Time zone | Pakistan Standard Time by default, configurable per tenant |

## 14. Extensibility for future product types

The snack version ships first, but the data model must allow carton-based products with expiry dates to be added later without rewriting core modules.

- **Units of measure:** each product has a base unit and conversion factors (e.g. piece → half dozen → dozen → carton). Snacks use dozen and half dozen only; other tenants define their own.
- **Batches:** batch table already exists with quantity; fields for batch number, manufacturing date and expiry date are present but hidden until a tenant turns on expiry tracking.
- **Dispatch rule:** configurable per tenant, starting with "any batch"; later "first expiry, first out" with near-expiry alerts.
- **Pricing:** structure allows per-customer-type prices and schemes (e.g. 10+1 free) later, though everyone pays one rate today.
- **Tax:** tax fields on products and bills exist but are off by default.
- **Order channels:** orders carry a source field (office, WhatsApp, booker app) so WhatsApp ordering can be plugged in.
- **Driver app:** the reconciliation API is designed so a future driver mobile app can submit the same data staff enter today.

## 15. Core data model

All money and stock balances come from two append-only journals, ledger entries and stock movements; every other table describes documents that post to them.

| Group | Entities |
| --- | --- |
| Platform | Tenant, Subscription, User, Role, Permission, AuditLog |
| Master | Warehouse, Company, Product, ProductPriceHistory, UnitConversion, Customer, Area, Bike, Staff, ExpenseCategory |
| Purchasing | PurchaseOrder, PurchaseOrderLine, GoodsReceipt, GoodsReceiptLine, CompanyBill, CompanyPayment, CompanyClaim, CompanyReturn |
| Inventory | Batch, StockMovement (type, product, batch, warehouse, quantity, reference), StockAdjustment (status: pending, approved, rejected) |
| Sales | SalesOrder, SalesOrderLine (product, company, quantity, rate, discount), Bill, BillRevision |
| Delivery | DeliveryPlan (date), Trip (bike, driver), TripStop (order, sequence), DeliveryResult (delivered, returned, damaged quantities), DriverCashReconciliation |
| Payments | CustomerPayment, PaymentAllocation (payment → bill, company, amount), Cheque |
| Accounting | LedgerEntry (party type: customer, company, staff; party ID; company ID; debit; credit; reference) |
| Expenses and payroll | Expense, RecurringExpense, SalaryRun, SalaryLine, StaffAdvance, Incentive |
| Messaging | NotificationTemplate, ScheduledReport, MessageLog |

The customer-per-company ledger works because every customer ledger entry also stores the company ID, so one query gives the customer's total and another gives one company's slice.

## 16. Phased build plan

Build the daily money and stock loop first for your own business, then add planning, reports and SaaS features once it runs reliably.

1. **Phase 1, core operations:** tenant and user setup, roles, master data with Excel import, purchase receipts and company bills, inventory, sales orders, A5 bill printing, day-end entry of deliveries, returns, damage and payments, customer and company ledgers, audit log.
   - Done when: one full week of real business runs in the system with ledgers matching paper records.
2. **Phase 2, delivery and money control:** delivery planning with load suggestions, loading sheets, driver cash reconciliation, expenses, payroll, stock adjustment approval, cheque tracking.
3. **Phase 3, reports and dashboard:** profit and loss, ageing, suggested orders, product demand, delivery performance, owner and staff dashboards, PDF and Excel export.
4. **Phase 4, notifications:** WhatsApp daily summary, overdue reminders, customer bills and statements.
5. **Phase 5, SaaS launch:** self sign-up, setup wizard, annual subscription and renewals, super admin panel, tenant branding.
6. **Later:** expiry and carton tracking, customer-type pricing and schemes, WhatsApp order taking, driver mobile app, GPS routing.

## 17. Open questions

These choices were made as reasonable defaults and need your confirmation.

- [x] Is the company discount a percentage, a fixed amount per dozen, or either? **Answered:** a fixed PKR amount per dozen, with quantity slabs per product (e.g. a bigger per-dozen discount from 25 dozen). Percent is kept as an option for other tenants.
- [x] Does the company also reimburse the sale value of delivery damage, or only replace the stock at purchase rate? **Answered:** purchase cost only.
- [ ] Suggested order: is minimum level minus available stock enough, or should it also use recent sales?
- [ ] Driver cash short: deduct from salary automatically, or only when the owner chooses?
- [ ] When returns at delivery take a line below a discount slab, should the slab discount be removed from what the customer kept? (Default for now: no, the booked discount stays.)
- [ ] Ageing buckets: are 0–7, 8–15, 16–30, 31–60 and 60+ days right for your customers?
- [ ] Which target tenants after you (snacks only, or any FMCG distributor), and what annual price?
- [ ] Preferred tech stack and hosting, or should a recommendation be added?
