# Progress

Running log of what has been built, decisions taken, and open items. Newest first.

## Change list from the owner (round 1)

From the owner's notes after trying Phase 1. Built one item at a time.

1. **Opening stock — done.** Inventory → Opening stock (owner only):
   - every product with its opening stock so far and what is on hand now, and a box for the
     opening stock in dozens; keyboard-first (Enter = next product, Ctrl+Enter = save);
   - no company bill: the goods were bought before the app;
   - saving sets each product's opening stock to the number typed. Only the difference is posted
     (an `OPENING` stock movement), so saving twice changes nothing and a later correction is
     recorded, not overwritten;
   - the stock goes into one opening batch per product and is dispatched oldest batch first like
     any other stock;
   - it can't be lowered below what is left of that batch (stock already sent out);
   - audited. Tested in `journals.int.test.ts`, and in a browser run (owner saves; staff get
     "No access").

2. **Driver chosen later — done.**
   - A trip's driver is optional (migration `trip_driver_optional`). Planning starts with "Not
     decided yet"; the bike's usual driver is not filled in.
   - The trip page has a driver picker while the trip is planned or out; it can be set, changed or
     cleared until day-end is done (audited).
   - With no driver, the trip list says "Not set" and the loading sheet prints
     "Driver: ____________________" to fill in by hand.
   - Tested in `delivery.int.test.ts` and in a browser run.

3. **Bill print spacing — done.** Wider gaps between the bill's columns. Long product and
   company names wrap onto a second line instead of squeezing the numbers; quantities, rates and
   amounts never wrap. Checked in print at A5 width, full bill and one-company slices.

4. **Minimum payment — done.** The least the customer should pay: the balance left from earlier
   bills, or what brings the total due back within their credit limit, whichever is more (just the
   earlier balance when there is no limit; never below zero). `minimumPayment` in `src/lib/sales.ts`.
   - Printed on the full bill under "Total due". Not on one-company slices, because the credit
     limit is the customer's, not a company's.
   - The day-end screen shows it next to the total due, updating with returns, and warns
     "… short of the minimum payment" when less is collected (a warning only; it doesn't block).
   - Uses the customer's credit limit at the time of printing, so a reprint follows a changed limit.
   - Tested in `sales.test.ts` and `sales.int.test.ts`, and in a browser run.

5. **Old balance — done.** Unpaid paper bills from before the app, owed to us and not to any
   company (table `CustomerOldBill`, migration `customer_old_bills`).
   - Customer → Old balance (owner and accountant), also linked from the statement: date, optional
     bill number, unpaid amount, note. A list shows each old bill with how much is paid (payments
     go to the oldest first). "Remove" (with a reason) posts a reversal; refused once payments have
     used the bill up.
   - Each posts a customer `OPENING_BALANCE` ledger entry with **no company**: the approved
     exception to CLAUDE.md rule 3 (noted there). The `LedgerEntry_party_check` constraint now
     allows a null company on customer entries only for opening balance, payment, cheque bounce
     and reversal entries.
   - Counts in the customer's total (credit limit, pending, minimum payment). Shows as "Old
     balance" on the printed bill (apart from the company "Previous pending"), on the statement
     (rows and the by-company summary), on order entry and on the payment screen. Left out of
     every company figure: bill slices, company receivables, a one-company statement.
   - Payments: oldest debt first now pays the old balance before anything else (then company
     opening balances, then bills). "Split by company" has an "Old balance" box; more than is owed
     there is refused.
   - The demo seed gives 5 customers an old bill.
   - Tested in `payments.test.ts` and `payments.int.test.ts` (incl. idempotent retry, bounce,
     removal rules, DB check, permissions), and in a browser run.

6. **Damage and returns in packets — done.** The base unit is now the **packet** (12 = 1 dozen;
   a half dozen = 6), instead of the half dozen. `PACKETS_PER_DOZEN` in `src/lib/units.ts`; rates
   stay per dozen, so a loose packet is priced at rate ÷ 12.
   - Migration `packets_base_unit` multiplies every stored quantity by 6: stock movements and
     adjustments, order lines (incl. returned and damaged), purchase and receipt lines, claims,
     bike capacity, minimum stock, discount slabs, and the quantities inside price-history slabs
     and bill revision snapshots. The append-only triggers on those three tables are switched off
     only for this restatement and back on in the same migration. Unit conversions now read
     PACKET = 1, HALF_DOZEN = 6, DOZEN = 12. Checked on a copy of demo data: every total is
     exactly 6×, and bill snapshots still match their order lines.
   - Orders, purchases, opening stock, slabs and capacity are still entered in whole or half
     dozens.
   - Typed in packets: day-end returned and damaged (with "= 2.5 dz" shown under each box),
     damaged stock sent back to the company, and damage claims.
   - Display: whole and half dozens as before ("3.5 dz"); loose packets as "2 dz 10 pk" (bill,
     loading sheet, day-end, stock screens).
   - Tests updated to packets, plus new ones for loose packets (pricing, re-pricing at day-end,
     display). Checked in a browser: day-end with 5 returned and 3 damaged packets, and the
     revised bill print.

7. **Damage claims settled by the user — done.** (migration `claim_settlement`)
   - Damage entered at day-end now creates a claim **Pending: settle with company** (status
     `AWAITING`), valued at purchase cost, with **no money moved**.
   - On Purchases → Claims (owner and accountant), each pending claim has an "Amount the company
     accepted" box (filled with the claimed value), a note, and **Accept** or **Reject**:
     - Accept (in full or a smaller amount, never more than claimed) posts the credit to the
       company ledger, and the claim is deducted on the company's next bill automatically.
     - Reject moves no money; the damaged stock stays in the damaged bucket.
     - The list shows "claimed X" when less was accepted, and the settlement note. Audited.
   - Claims logged by hand on the claims screen are still posted at once, and existing claims
     stay as they were (`claimedAmount` backfilled).
   - Undo day-end also cancels a still-pending claim; a pending claim can be cancelled (logged by
     mistake) as well as rejected.
   - Tested in `delivery.int.test.ts` (accept less, reject, limits, permissions, deduction on the
     next bill) and in a browser run.

## Name: Taqseem — done

- The product is now **Taqseem** (تقسیم, Urdu for _distribution_), with the tagline "Orders,
  delivery, stock and khata in one place". It shows in browser tab titles, the sidebar, the
  sign-in page (with the Urdu name), the copied sign-in details for new users, the Windows setup
  window and the docs.
- The name lives in one place: `src/lib/brand.ts` (`APP_NAME`, `APP_NAME_URDU`, `TAGLINE`).
- Unchanged on purpose: the repository, package and database names (`sales-app`, `sales_app`)
  and the Windows data folder `%LOCALAPPDATA%\SalesApp`, so existing installations keep working
  and keep their data. The Windows setup replaces its old "Sales App" firewall rule with a
  "Taqseem" one.
- Windows setup also got a **fresh installation** option: when already installed, it asks
  1 = start and keep data (Enter) or 2 = delete all data and start empty (type DELETE).

## Day-end correction — done

A day-end saved with a mistake can now be undone and entered again. It was the main gap from the
Phase 1 review.

**Built**

- **"Undo day-end"** on a saved day-end (`/delivery/[trip]/day-end/[order]`), for the owner and
  accountant (`payments.manage`), with a reason. Staff see a note to ask them.
- In one serializable transaction, all by reversal (CLAUDE.md rule 2), nothing edited or deleted:
  - the return and damage stock movements get mirror `REVERSAL` movements, so stock is back as
    dispatched;
  - the order's damage claims are cancelled, with their company ledger credit reversed;
  - the bill goes back to what was dispatched as a new revision ("Day-end undone: reason"), and
    its day-end `BILL_REVISION` credits are reversed (the original sale stays);
  - the payments collected at that delivery are reversed;
  - the order is Dispatched again, its returned and damaged quantities are cleared, and its trip
    is open again;
  - one audit row records what was undone and why.
- The day-end form then opens again for the order, to enter it correctly.
- **Refused, with a clear message, when undoing would break something already done since:**
  - the damaged stock from the order was already sent back to the company, or the returned stock
    was already used;
  - a damage claim was already deducted on a company bill;
  - a cheque collected at that delivery has cleared.
- `reverseLedgerFor` can now reverse only some entry types, used to keep the sale and reverse the
  day-end revision.
- **Fix:** "Cheques waiting to clear" no longer lists cheques whose payment was reversed.

**Tests:** 225 in total.

- Integration (2 new, in `delivery.int.test.ts`):
  - undo restores the stock, damaged stock, claim, company ledger, bill (new revision), customer
    balance, payment, order and trip status; staff are refused; a second undo is refused;
  - entering the order again then gives the right balances;
  - refusals: damaged stock already sent back, claim already deducted, cheque already cleared.
- Browser run of the production build:
  - staff see the note, not the button;
  - the owner undid a refused order paid by cheque and a delivered order, then entered both again,
    and the trip closed again;
  - an order whose damaged stock had already been sent back was refused with the reason.

## Task 10: Phase 1 review — done

I reviewed the whole codebase against the CLAUDE.md rules and Phase 1 of `docs/SPEC.md`. Fixes and
additions in this task are marked **fixed** or **added**.

### Findings and fixes

**Bugs fixed**

1. **Double credit for damaged stock returned to a company.** The claim form offered "Damaged
   stock returned to company", which credited the company again for goods that day-end had
   already claimed, and never took them out of damaged stock. **Fixed:** that claim type is gone
   from the form. Damaged stock is now sent back from the product's stock card ("Send back"): it
   leaves the damaged bucket with a `RETURN_TO_COMPANY` movement, and no money moves. It is
   audited and idempotent.
2. **Two trips dispatched at the same moment could both take the same stock**, and two day-end
   saves could both pay off the same bill slice. **Fixed:** dispatch and day-end now run as
   serializable transactions, like the other payment and receipt posts.
3. **A concurrent-write abort showed an error page.** **Fixed:** `runAction` now turns it into
   "Someone saved related records at the same moment. Nothing was saved; please try again", and
   keeps the typed values.
4. **The printed bill added discounts with JavaScript floats.** **Fixed:** it now uses decimals
   (rule 5).
5. **"Plan a trip" (and the new stock card) read today's date before the session**, which
   Next.js flags while prerendering. **Fixed:** the session is read first.
6. **Trip stops ignored the customer's visiting order** (`routeSequence`, set on the customer form
   and in the import). **Fixed:** stops, the loading sheet, the planning list and day-end's "next
   order" now go by area route order, then visiting order, then name (`byRoute`, unit-tested).
7. **There was no way to create a real tenant**: only the demo seed made one, and the super admin
   panel is Phase 5. **Added:** `pnpm tenant:create "Business name" "Owner name" owner@email`.
   It creates the tenant, the owner (with a one-time password to change at first sign-in), the
   unit conversions and an audit row. It is integration-tested.

**Missing Phase 1 pieces, added**

8. **Inventory screen** (`/inventory`, all roles; no costs shown):
   - on hand, reserved, available, minimum and damaged per product;
   - search, warehouse, company and "below minimum" filters;
   - totals, and print.
9. **Stock card** (`/inventory/[productId]`): every movement in a date range with running saleable
   and damaged balances and links to the receipt or order. Damaged stock can be sent back here.
10. **Audit log viewer** (Settings → Audit log, owner only, `audit.view`): filter by record type,
    action, user, record id and date range; old and new values expand per row.
11. **Search** on company bills, claims and delivery trips. Every transaction list now has search,
    filters and a date range.

**Rules hardened**

12. **Append-only journals in the data layer.** The tenant data layer now refuses update, upsert
    and delete on `LedgerEntry`, `StockMovement`, `BillRevision`, `AuditLog` and
    `ProductPriceHistory`, with a clear error. Database triggers already enforced this; a new test
    proves that even the raw client is refused.

**Checked and found consistent (no change needed)**

- Rule 1: raw Prisma is used only in the auth code (login, session, account). Every business
  query goes through `createTenantDb`, and raw SQL is blocked there.
- Rule 2:
  - no code edits or deletes a journal row;
  - corrections are reversal rows (`reverseLedgerFor`, stock `REVERSAL`, `CHEQUE_BOUNCE`);
  - company bills post at gross with claims credited separately, so nothing is counted twice.
- Rule 3: every customer ledger entry has `companyId`, enforced by a CHECK constraint and checked
  again in the new journal test.
- Rule 4: quantities are integer half dozens everywhere. `UnitConversion` exists and is seeded.
- Rule 5: money is `Decimal(14,2)` in the database and `decimal.js` / `Prisma.Decimal` in code.
  The only float uses left are Excel cell values (a display format) and text-box parsing in the
  company payment form.
- Rule 6: every create, update, post and reversal in the services writes an audit row in the
  same transaction.
- Rule 7: every create form sends a `requestId`, and services return the existing record on retry.
  Order, payment and trip claims use status conditions so double clicks cannot post twice.
- Rule 8:
  - every service checks the permission (`assertCan`), and every page checks it too;
  - staff never get purchase rates (products, purchase orders, receipts and claims hide them
    without `financials.view`);
  - the claims, company bills, company ledger, statement and payments pages are for owner and
    accountant only.
- Rule 9: `Batch` has batch number, manufacturing and expiry dates; tax fields exist and are off;
  `SalesOrder.source` is OFFICE, WHATSAPP or BOOKER_APP.

**Tests added**

- `journals.int.test.ts` (9 tests) runs a realistic week through every posting path:
  - receipts and a cancelled receipt;
  - orders and a cancelled order;
  - dispatch;
  - day-end with returns and damage;
  - office and delivery payments, a bounced cheque and a reversed payment;
  - a company payment, and a damage claim deducted on the next company bill;
  - damaged stock sent back.

  It then checks against hand-worked totals that:
  - stock on hand = received − dispatched + returned per product, damage sits in its own bucket,
    and reserved counts only open orders;
  - the inventory screen and the stock card (running balances and opening from a date) agree with
    the journal;
  - every customer entry has a company and no entry is zero;
  - customer pending = opening + revised bills − payments that still stand;
  - each bill's ledger postings = the bill after day-end = the sum of its company sections;
  - allocations never exceed a bill slice, and the bill-by-bill debt adds up to the ledger balance;
  - statements (all companies and per company) and company receivables add up to the same totals;
  - company payable = opening + bills − payments − claims, on the ledger and its screen, with the
    claim deducted on the next bill.

- `actions.test.ts`: the concurrent-write message, business errors, and that unexpected errors are
  rethrown.
- `tenant.test.ts` and `tenant.int.test.ts`: append-only checks in the data layer and in the
  database.

**Tests:** 223 in total, all passing; the suite was also run three times in a row to check that
serializable transactions don't make it flaky.

### Phase 1 completion checklist

SPEC §16, Phase 1: "tenant and user setup, roles, master data with Excel import, purchase receipts
and company bills, inventory, sales orders, A5 bill printing, day-end entry of deliveries, returns,
damage and payments, customer and company ledgers, audit log."

| Item                                           | Status          | Where                                                                                                                                                                                            |
| ---------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tenant and user setup                          | Done            | `pnpm tenant:create` for a new tenant and owner (Task 10); Settings → Users (invite, role, deactivate, reset password)                                                                           |
| Roles: owner, accountant, staff, super admin   | Done            | `src/server/auth/permissions.ts`, checked on the server                                                                                                                                          |
| Master data                                    | Done            | Warehouses, areas, bikes, staff, companies (opening balance, booker, terms), products (rates with history, discount slabs, minimum level), customers (opening balance per company, credit limit) |
| Excel import                                   | Done            | Products and customers, with preview (Task 4)                                                                                                                                                    |
| Purchase orders, receipts, company bills       | Done            | Purchases; due dates, claims deducted on the next bill                                                                                                                                           |
| Company payments and ledger                    | Done            | Oldest bills first or manual; bill-wise status; overdue; Excel                                                                                                                                   |
| Inventory                                      | Done            | Stock per product (Task 10), stock card, damaged stock sent back                                                                                                                                 |
| Stock adjustments (request / approve)          | Phase 2         | `StockAdjustment` table exists; the seed has one pending                                                                                                                                         |
| Sales orders                                   | Done            | Keyboard-first entry, credit limit with owner approval, stock reservation                                                                                                                        |
| A5 bill printing                               | Done            | A5 default; A4, half A4, A6, custom; 2 per A4; logo; split by company; bulk print                                                                                                                |
| Dispatch                                       | Done (simple)   | Trips per bike and driver, loading sheet; load suggestions are Phase 2                                                                                                                           |
| Day-end: deliveries, returns, damage, payments | Done            | Bills revised automatically, claims, payments split by company                                                                                                                                   |
| Customer payments, cheques                     | Done            | Office payments, cleared or bounced cheques, reversal, flag                                                                                                                                      |
| Customer ledger (all companies, per company)   | Done            | Statement with print, PDF and Excel                                                                                                                                                              |
| Company ledger and company × all customers     | Done            | Company ledger, statement, customer balances                                                                                                                                                     |
| Audit log                                      | Done            | Written on every change; viewer added in Task 10                                                                                                                                                 |
| Seed demo tenant                               | Done            | 2 warehouses, 3 companies, 20 products, 30 customers, 4 bikes, plus a trip and orders                                                                                                            |
| Before go-live: one real week matches paper    | **Owner to do** | SPEC §16 "done when"                                                                                                                                                                             |

### Open items, by phase

**Not Phase 1 (planned later):**

- Phase 2:
  - delivery planning with load suggestions and drag-and-drop stop ordering (stops follow area
    route order and each customer's visiting order today);
  - driver cash hand-in with short or excess against the driver;
  - expenses and payroll (placeholder page);
  - stock adjustment approval screens;
  - cheque register by due date;
  - one-click rescheduling of undelivered orders.
- Phase 3: dashboard (placeholder page), reports (placeholder page), suggested order quantities,
  profit and loss, ageing.
- Phase 4: WhatsApp notifications.
- Phase 5:
  - self sign-up, setup wizard, subscriptions, super admin panel;
  - per-tenant time zone (Pakistan time is the default today);
  - database row-level security. Isolation today is the tenant data layer plus composite
    foreign keys that refuse cross-tenant references.

**Worth doing before real use:**

- ~~Correcting a saved day-end~~: done ("Undo day-end", see the section above).
- **Login lockout** after repeated wrong passwords, and 2-step verification for owners
  (SPEC §13), are not built.
- **Refunds** of a customer advance are not built.
- **Auto-save of draft forms** (SPEC §13 weak internet) is not built. Retries are safe
  (`requestId`), but a closed tab loses a half-typed order.
- **Daily backups** belong to the hosting setup (Neon or Supabase point-in-time restore); a
  "tenant exports all data" button is not built.
- **CI:** there is no GitHub Actions workflow yet. lint, typecheck, test and build run only
  locally.

**Owner questions still open** (SPEC §17): driver cash short policy, ageing buckets, suggested
order rule, the slab discount after returns, target tenants and price.

## Task 9: Customer ledgers and payments — done

**Built**

- **Receive payment** (`/payments/new`, owner and accountant):
  - pick the customer (type name, shop, phone or area); the screen shows what they owe in total
    and per company, a flag warning (bounced cheque), and every unpaid debt: opening balance per
    company and each bill's company slices;
  - cash, cheque (number, bank, date) or online transfer (reference), date and note;
  - **Oldest debt first** (default): the screen previews exactly how the amount will be applied,
    using the same code as the server (`src/lib/payments.ts`);
  - **Split by company** (manual override): an amount per company, which must add up to the
    payment; within each company it pays the opening balance, then that company's bills oldest
    first;
  - "Post and receive next" for a pile of payments; retries never post twice (`requestId`).
- **Allocation rule** (SPEC §8), shared with day-end payments:
  1. Debt the bills don't explain (opening balances) is the oldest, so it is paid first, split by
     company in proportion.
  2. Then posted bills, oldest first. Paying part of a bill with several companies splits it in
     proportion to each company's unpaid amount on that bill.
  3. Anything left is an advance with the companies of the customer's latest bill (or the order's
     companies at day-end). When the customer has never had a bill, the screen asks for a split by
     company.
  4. An earlier advance counts as paying the oldest bill slices first, so it is never applied twice.
- **Payments list** (`/payments`): search (number, customer, shop, cheque number, reference),
  method, cheque status, received at office or at delivery, posted or reversed, date range, and
  the total. "Cheques waiting to clear" is one click.
- **Payment page** (`/payments/[id]`): amount credited per company, bills it was applied to, the
  order it was collected on.
  - **Cheque cleared:** marks the cheque cleared.
  - **Cheque bounced** (with a reason): reverses the payment with `CHEQUE_BOUNCE` ledger entries,
    so the customer owes it again and the bills are unpaid again. The customer is **flagged** with
    the reason, and the flag shows on the customers list, the order screen and the payment screen.
  - **Reverse payment** (with a reason): for a payment entered by mistake. Not allowed once a
    cheque has cleared.
  - "Remove flag" on the customer page (owner and accountant), audited.
- **Ledger views**, all with a date range, print / PDF and Excel:
  - **Customer, all companies** and **customer × company:** the statement from Task 7
    (`/customers/[id]/statement`), now with "Download Excel" and "Receive payment";
  - **Company, all customers** (`/companies/[id]/receivables`, "Customer balances" on the company
    ledger): each customer's opening, bills, received and what they owe for that company, with
    totals. Each name opens that customer's statement for the company.
- Every post, reversal, cheque status change and flag change is audited.

**Changed:** day-end payments now use the same oldest-debt-first rule (before, they were split by
each company's balance). The day-end test was updated.

**Tests:** 207 in total.

- Unit (`payments.test.ts`, 7): effective debt with opening balance and with an earlier advance;
  oldest first across opening balance, full and part bills; split of a part bill by company; advance;
  manual company split; split must add up.
- Integration (`payments.int.test.ts`, 7):
  - office cash across opening balance and a two-company bill, to the paisa, until everything is
    paid;
  - manual company split, with an advance that shows as negative owed;
  - advance needs a company when nothing was ever billed; idempotency; staff refused;
  - bounced cheque reverses, restores the debt and the bill, flags the customer, cannot bounce
    twice; flag removed (staff refused);
  - cleared cheque cannot bounce or be reversed; cash reversal; list filters;
  - customer statement (all and one company) and company receivables (with an opening date) agree
    with the ledger; staff refused.
- Browser run of the production build as the accountant:
  - cash payment with the preview matching what was posted;
  - a cheque (the form won't send without its number), then bounced; the customer is flagged;
  - statement and customer balances downloaded as Excel, customer balances printed as an A4 PDF;
  - staff get "No access" on payments.

### Design choices that are not obvious

1. **Opening balances are paid first.** They are older than any bill, and they have no bill to
   allocate to, so the payment credits the company's ledger without an allocation row.
2. **The manual override is per company, not per bill.** What matters to the ledgers is how much
   each company gets. Within a company, bills are still paid oldest first.
3. **A bounced cheque is a reversal, not a new negative payment.** The mirror entries point back to
   the original (`reversalOfId`) and use the `CHEQUE_BOUNCE` type, so the statement says why the
   balance went up.

**Open / next**

- Cheques are tracked by status only. A cheque register by due date and reminders come with
  Phase 2 cheque tracking.
- Refunds of an advance to a customer are not built.

## Task 8: Simple dispatch and day-end reconciliation — done

**Built**

- **Delivery trips** (`/delivery`): one bike's run on a date, with a driver.
  - **Plan a trip** (`/delivery/new`): pick the date, the bike and the driver. The bike's usual
    driver is filled in, and only orders from the bike's warehouse are listed.
  - Tick that date's booked orders, grouped by area. The load updates while you tick, against the
    bike's capacity, and turns red when over it.
  - The ticked orders become **Planned**. Until dispatch, orders can be added or removed (back to
    Booked) and the trip can be cancelled.
  - Moving a planned order to another delivery date takes it off its trip.
  - The trip list has status and date filters, and shows load, orders, bill total and how many
    orders have their day-end entered.
- **Loading sheet** (`/delivery/[id]/loading-sheet`, A4):
  - product totals by company, with a tick box to mark each loaded;
  - stops in visiting order (by area route order, then customer) with address, phone, order,
    dozens and bill amount.
  - "Print bills" opens all the trip's bills in one print run (the Task 7 bulk print page).
- **Dispatch** (one transaction):
  - refuses if the warehouse is short of any product (naming each, with what is needed and on
    hand), or if an order still waits for owner credit approval;
  - takes stock out oldest batch first;
  - posts each bill to the customer ledger, one `SALES_BILL` entry per company slice;
  - freezes "previous pending" (overall and per company, in the new `Bill.previousByCompany`);
  - marks the orders **Dispatched**;
  - the trip is claimed first, so a double click never dispatches twice.
- **Day-end entry** (`/delivery/[id]/day-end/[orderId]`, one order at a time from its signed bill):
  - per product: returned and damaged dozens (halves allowed). "Customer refused all" fills every
    line as returned;
  - cash, online (with reference) and cheque (number, bank, date) collected;
  - the screen shows the bill after returns and damage, previous pending, total due, collected and
    still pending while you type;
  - keyboard-first: Enter goes to the next box, Ctrl+Enter saves;
  - saving opens the trip's next order still to enter, and returns to the trip after the last one.
- **What saving an order's day-end does** (one transaction, audited):
  - returned stock goes back to saleable stock (to the batch it left from);
  - damaged stock moves to the damaged bucket, and a **company claim** is created at purchase cost
    (SPEC §17), crediting the company ledger, with the claim linked to the order;
  - the **bill is revised automatically**: lines are re-priced on what the customer kept, a new
    `BillRevision` is saved, and the reduction is credited per company (`BILL_REVISION`);
  - **payments** are posted as customer payments (collected via delivery, with a cheque record for
    cheques), split by company with the oldest-debt-first rule (Task 9 changed this from a split
    by each company's balance). When nothing is owed (an advance), it is split over this order's
    companies;
  - the order becomes **Delivered**, **Partly delivered** or **Returned**, and the trip becomes
    **Day-end done** once every order is entered;
  - a retried save (same `requestId`) does nothing, and a second entry for the same order is refused.
- The order page shows its trip, a link to day-end, and delivered quantities once entered.
- Seed: the delivered demo order now sits on a finished trip with a revised bill. Tomorrow's 13
  booked orders are ready to plan.

**Tests:** 193 in total.

- Unit (`delivery.test.ts`): day-end quantity checks, re-pricing on what was kept, order status,
  payment split to the paisa, oldest-batch stock out, load per product.
- Integration (`delivery.int.test.ts`, 7 tests):
  - planning, adding, removing and cancelling; the same order on two trips; other date or
    warehouse refused; trip idempotency;
  - dispatch stock, ledger per company and frozen previous pending (bill view);
  - short stock and credit approval block dispatch;
  - day-end with returns, damage claim, bill revision, cash split by company and the running
    balance;
  - refused order with a cheque as an advance; trip closes; retries and double entry;
  - quantity validation.
- Browser run of the production build as staff:
  - planned 9 orders on a bike (over capacity shown), loading sheet as an A4 PDF;
  - removed an order and added it back, then dispatched;
  - day-end by keyboard with returns, damage and cash;
  - a refused order with a cheque, where the missing cheque number is caught and typed values kept;
  - the remaining orders saved in a row, and the trip closed;
  - the revised bill checked.

### Design choices that are not obvious

1. **Re-pricing keeps the booked rate and per-dozen discount.** If returns take a line below a
   discount slab, the customer keeps the slab's discount on what they kept. This is simpler to
   explain on the bill. If the company withdraws the slab in that case, this needs the owner's
   answer (open question below).
2. **Damage is not charged to the customer.** It is our delivery loss, claimed from the company at
   purchase cost, so the bill drops by the damaged quantity just like a return.
3. **Payments pay the oldest debt, not this bill.** Customers usually pay the previous bill when
   the next order arrives (SPEC §8). Since Task 9 this follows the shared oldest-debt-first rule
   (see Task 9).
4. **Over capacity is a warning, not a block.** Bikes are sometimes loaded heavier, and Phase 2
   brings load suggestions.

**Open / next**

- **Driver cash hand-in** (expected vs handed in, short or excess against the driver) is Phase 2.
  The trip page already totals cash, cheque and online collected.
- **Correcting a saved day-end:** done later ("Undo day-end").
- **Rescheduling undelivered orders** in one click is not built; book the order again (Repeat last
  order).
- **Question for the owner:** when returns take a line below a discount slab, should the slab
  discount be removed?

## Task 7: Bill printing — done

**Built**

- **Settings → Business & printing** (`/settings/printing`, owner only):
  - business name, address and phone for the letterhead;
  - logo upload: PNG, JPEG or WebP up to 200 KB. The type is checked from the file's bytes, not
    its name, and the logo is stored as a data URL on the tenant. It can be replaced or removed.
  - bill paper: **A5 (default)**, A4, half A4, A6 or a custom size in mm;
  - margin (0–30 mm), font size (7–16 pt) and **"2 bills per A4"**;
  - every change is audited. The database also checks the ranges (CHECK constraints).
- **Letterhead:** logo, name, address and phone when set; the business name alone otherwise.
- **Customer bill** (`/orders/[id]/bill`), full or split by company:
  - laid out on the tenant's paper;
  - on screen it is shown at the real paper size, so the preview matches the print;
  - with 2 per A4, two half-A4 bills share a sheet with a dashed cut line, and split pages pair up
    the same way;
  - sizes are in `em`, so the font-size setting scales the whole bill;
  - black and white only.
- **Print bills for selected orders:**
  - the orders list has a tick box per order (and "select all on this page");
  - "Print selected bills" and "Print selected, split by company" open `/orders/print` in a new
    tab with every bill in one print run (up to 200);
  - orders without a bill are skipped and counted.
- **Customer statement** (`/customers/[id]/statement`, from the balance on the customers list):
  - all companies or one company, for a date range (default: 1st of last month to today);
  - opening balance, every entry with its company and a running balance, and the closing balance;
  - "balance by company" when showing all companies.
- **Company statement** (`/companies/[id]/statement`, "Printable statement" on the company
  ledger):
  - same layout, showing what we owe;
  - statements always print on A4 with the tenant's margin (at least 8 mm) and font size.
- Print CSS lives in `src/lib/print.ts` (pure and unit-tested): `@page` size and margin, and page
  breaks between bills. The app's sidebar, toolbars and filters are hidden when printing.

**Tests:** 179 in total.

- Unit: paper sizes, layouts, sheet grouping and page CSS for each mode; settings validation;
  logo type sniffing.
- Integration (`printing.int.test.ts`, 10 tests):
  - default profile;
  - saving settings, with the audit row, custom-size rules and range errors;
  - owner-only access;
  - logo accepted, wrong type, too large and removal;
  - statement running balance, company filter and opening carried forward;
  - statement hidden from staff and other tenants;
  - bulk bills order, de-duplication, skipped ids, tenant isolation and the 200 limit.
- Browser run of the production build:
  - select all / select two and bulk print (2 A5 pages in the PDF);
  - the settings form error keeps typed values; save with 2 per A4;
  - logo upload, and a rejected fake image;
  - split bill on one A4 sheet with the logo;
  - customer statement with the company filter, and the company statement as an A4 PDF;
  - staff get "No access" on statements and settings.

### Design choices that are not obvious

1. **Print CSS, no PDF library.** The browser's print dialog prints and saves as PDF, which keeps
   pages light (CLAUDE.md UX rules). Paper size comes from the `@page` rule the page writes from
   the tenant settings, so most browsers pick the right paper automatically.
2. **2 per A4 overrides the paper size.** With it on, the page is A4 with no page margin, and each
   half gets the margin as padding, so the cut line sits exactly at 148.5 mm. A bill too long for
   half a page is clipped. Use a single-bill size for very long orders.
3. **Logo as a data URL in the database.** There is no file storage yet, and a 200 KB cap keeps
   rows small. SVG is refused because it can carry scripts.
4. **Statements read the journals directly.** The customer statement sums `LedgerEntry` rows (with
   `companyId`, CLAUDE.md rule 3), and the company statement reuses the company ledger service, so
   printed figures always match the ledger screens.

**Open / next**

- Bills that are not dispatched still show "previous pending" live (see Task 6). They are frozen
  at dispatch in Task 8.
- "Print all bills of a trip" was added to the trip page in Task 8.
- Excel export of the customer statement comes with the reports in a later task. The company
  ledger already exports.

## Task 6: Sales orders and bills — done

**Built**

- **Keyboard-first order entry** (`/orders/new`):
  - type the customer (name, shop, phone or area) and press Enter;
  - type a product code or name, Enter, type dozens (3.5 = 3½ dozen), Enter; you're back in the
    product search for the next line;
  - **Ctrl+Enter** books the order. "Book and enter next" opens a blank order straight away, and
    "Repeat last order" copies the customer's previous order.
  - Plain Enter never submits by accident.
- **Customer panel:**
  - pending now (total and per company), other open orders, this order (per company), "after this
    order" and the credit limit;
  - flagged customers (bounced cheque) are marked.
- **Lines:**
  - products from any company in the customer's warehouse (from their area; customers without an
    area choose a warehouse);
  - **available stock** (on hand − reserved) beside each line, with a "Short" badge when booking
    more;
  - sale rate from the product with the **company discount applied automatically**, including the
    quantity slab the line reaches;
  - amounts update while typing. The browser and the server use the same pricing code
    (`src/lib/pricing.ts`, `src/lib/sales.ts`, now on plain `decimal.js`), and the server prices
    again when saving.
- **Credit limit:** the check is pending + other open orders + this order.
  - Staff can still book past the limit; the order is marked **"Needs owner approval"** and the
    owner approves it on the order page.
  - The owner booking past the limit must tick "Allow past the credit limit".
  - Overrides are stored (`creditOverrideById/At`) and audited.
- **Statuses:** Booked → Planned → Dispatched → Delivered / Partly delivered / Returned (or
  Cancelled). The state machine is in `src/lib/sales.ts`; Planned and Dispatched are set by
  delivery (Task 8). Booked and planned orders **reserve stock** and can be edited or cancelled;
  after dispatch only day-end entry changes them.
- **Bills:**
  - one bill per order (several companies allowed), created at booking;
  - every version is kept as a **bill revision** (booked, each edit, later each delivery
    correction), and the order page lists them;
  - the bill page (`/orders/[id]/bill`) prints as A5, **full or split by company** (one page per
    company), showing **previous pending, this bill and total due**; in the split view each figure
    is that company's slice of the customer ledger.
- **Orders list:** search (number, customer, shop, phone), status (including "open"), area,
  "needs owner approval", delivery date range, and a count and amount total.
- **Idempotency:** new orders carry a client `requestId`, so a retried "Book order" returns the
  order already booked. Every create, edit, cancel and approval is audited, with old and new lines.

**Tests:** 159 in total.

- Unit: line pricing with slabs, bill totals per company, credit check, status machine.
- Integration (`sales.int.test.ts`, 12 tests):
  - pricing and company snapshot, and nothing posted at booking;
  - reservation (book / edit / cancel);
  - shortages;
  - warehouse rules;
  - idempotency;
  - staff-versus-owner credit rules and approval;
  - edits adding revisions, and no edits after dispatch;
  - bill view totals overall and per company;
  - the entry-screen context.
- Browser run of the production build covering:
  - a keyboard-only order;
  - the credit warning for staff and for the owner, and approval;
  - an edit with a revision and "repeat last order";
  - full and split bills;
  - cancel.

### Design choices that are not obvious

1. **The bill posts to the customer ledger at dispatch, not at booking.** Booking creates the bill
   (number, printable, revision 1), but nothing goes into the stock or money journals until goods
   leave (Task 8 sets `Bill.postedAt`, posts `SALES_BILL` per company and the dispatch stock
   movements). So edits and cancellations before dispatch need no reversals. Until posting, the
   bill shows "Draft until dispatch" and its "previous pending" is the live balance; at dispatch it
   is frozen (overall in `Bill.previousBalance`, per company in the revision's `companyTotals`).
2. **The credit check counts open orders.** Booked/planned bills that are not yet posted count
   towards the limit, so two orders in a row can't each slip under it.
3. **Booking beyond available stock is allowed, with a warning.** Stock often arrives the next
   morning before dispatch. Dispatch (Task 8) will refuse to send more than is on hand.
4. **Edits replace the order lines but never the bill history.** The lines table is current state;
   `BillRevision` (append-only) keeps every version, and the audit log keeps old and new lines.
5. **Previous pending per company.** The split bill uses the customer × company ledger slice, so
   each company's page shows what the customer owes for that company only (CLAUDE.md rule 3).

**Open / next**

- Paper sizes, margins, 2 bills per A4 and the logo were done in Task 7.
- Dispatch and the Planned status were done in Task 8.
- Two orders for the same customer booked at the same moment could each pass the credit check.
  This is rare at one office; dispatch can re-check later.

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
