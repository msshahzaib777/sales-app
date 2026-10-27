import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  type CustomerType,
  type DiscountType,
  Prisma,
  PrismaClient,
} from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { DEFAULT_EXPENSE_CATEGORIES } from "../src/lib/expenses";
import { PACKETS_PER_DOZEN } from "../src/lib/units";
import {
  calculateLineAmounts,
  type DiscountTier,
  resolveDiscount,
  sumLineAmounts,
} from "../src/lib/pricing";

// Demo tenant: 2 warehouses, 3 companies, 20 products, 30 customers, 4 bikes (CLAUDE.md), plus
// opening balances, a received purchase per company, one delivered order with bill, payment and a
// damage claim, and booked orders for tomorrow — enough to try every Phase 1 screen.
//
// Journals are append-only, so the seed only runs on an empty demo tenant. To start over:
// `pnpm db:reset` (drops and recreates the database, then seeds).

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_PASSWORD = "Demo@12345";
const dz = (dozens: number) => dozens * PACKETS_PER_DOZEN;

// Deterministic pseudo-random numbers so every seed run produces the same data.
let rngState = 20261024;
function rand() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/** Business date (stored as @db.Date) `offset` days from today in Pakistan time. */
function day(offset = 0) {
  const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate() + offset));
}

type ProductSeed = {
  code: string;
  name: string;
  purchaseRate: number;
  saleRate: number;
  discountType: DiscountType;
  discountValue: number;
  minDozens: number;
};

// Quantity slabs (per product line): from this many dozen, this PKR discount per dozen replaces
// the product's base discount for the whole line.
const DISCOUNT_SLABS: Record<string, { fromDozens: number; perDozen: number }[]> = {
  CB01: [{ fromDozens: 25, perDozen: 6 }],
  CB07: [
    { fromDozens: 25, perDozen: 15 },
    { fromDozens: 50, perDozen: 20 },
  ],
  GC01: [{ fromDozens: 25, perDozen: 8 }],
  GC02: [{ fromDozens: 25, perDozen: 15 }],
  MM01: [{ fromDozens: 25, perDozen: 10 }],
};

const WAREHOUSES = [
  { key: "A", name: "Shahdara Warehouse", address: "GT Road, Shahdara, Lahore" },
  { key: "B", name: "Township Warehouse", address: "Block 2, Township, Lahore" },
] as const;

const COMPANIES: {
  name: string;
  warehouse: "A" | "B";
  contactName: string;
  phone: string;
  orderBookerName: string;
  orderBookerPhone: string;
  paymentTermsDays: number;
  openingBalance: number;
  products: ProductSeed[];
}[] = [
  {
    name: "Crunchy Bites Foods",
    warehouse: "A",
    contactName: "Imran Qureshi",
    phone: "0300-1112233",
    orderBookerName: "Bilal Ahmed",
    orderBookerPhone: "0301-4455667",
    paymentTermsDays: 15,
    openingBalance: 185000,
    products: [
      {
        code: "CB01",
        name: "Masala Chips Rs10",
        purchaseRate: 100,
        saleRate: 110,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 4,
        minDozens: 40,
      },
      {
        code: "CB02",
        name: "Salted Chips Rs10",
        purchaseRate: 100,
        saleRate: 110,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 4,
        minDozens: 40,
      },
      {
        code: "CB03",
        name: "Masala Chips Rs20",
        purchaseRate: 205,
        saleRate: 225,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 4,
        minDozens: 30,
      },
      {
        code: "CB04",
        name: "Chilli Lemon Chips Rs20",
        purchaseRate: 205,
        saleRate: 225,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 4,
        minDozens: 25,
      },
      {
        code: "CB05",
        name: "Cheese Balls Rs10",
        purchaseRate: 98,
        saleRate: 108,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 30,
      },
      {
        code: "CB06",
        name: "Corn Puffs Rs10",
        purchaseRate: 96,
        saleRate: 106,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 30,
      },
      {
        code: "CB07",
        name: "Family Pack Chips Rs50",
        purchaseRate: 520,
        saleRate: 565,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 8,
        minDozens: 15,
      },
      {
        code: "CB08",
        name: "Nimko Mix Rs20",
        purchaseRate: 210,
        saleRate: 230,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 20,
      },
    ],
  },
  {
    name: "Golden Crisp Snacks",
    warehouse: "A",
    contactName: "Sadia Malik",
    phone: "0321-7788990",
    orderBookerName: "Usman Tariq",
    orderBookerPhone: "0322-1234321",
    paymentTermsDays: 30,
    openingBalance: 92500,
    products: [
      {
        code: "GC01",
        name: "Wavy Chips Rs20",
        purchaseRate: 208,
        saleRate: 228,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 4,
        minDozens: 25,
      },
      {
        code: "GC02",
        name: "Wavy Chips Rs50",
        purchaseRate: 515,
        saleRate: 560,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 10,
        minDozens: 12,
      },
      {
        code: "GC03",
        name: "Salted Peanuts Rs20",
        purchaseRate: 200,
        saleRate: 222,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 20,
      },
      {
        code: "GC04",
        name: "Spicy Peanuts Rs20",
        purchaseRate: 200,
        saleRate: 222,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 20,
      },
      {
        code: "GC05",
        name: "Popcorn Butter Rs10",
        purchaseRate: 95,
        saleRate: 105,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 2,
        minDozens: 30,
      },
      {
        code: "GC06",
        name: "Popcorn Caramel Rs20",
        purchaseRate: 198,
        saleRate: 220,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 4,
        minDozens: 15,
      },
      {
        code: "GC07",
        name: "Salanty Sticks Rs10",
        purchaseRate: 92,
        saleRate: 102,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 35,
      },
    ],
  },
  {
    name: "Masala Munch Industries",
    warehouse: "B",
    contactName: "Kashif Raza",
    phone: "0333-5566778",
    orderBookerName: "Hamza Iqbal",
    orderBookerPhone: "0334-9988776",
    paymentTermsDays: 7,
    openingBalance: 64000,
    products: [
      {
        code: "MM01",
        name: "Daal Moth Rs20",
        purchaseRate: 202,
        saleRate: 224,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 6,
        minDozens: 20,
      },
      {
        code: "MM02",
        name: "Chana Chor Rs20",
        purchaseRate: 202,
        saleRate: 224,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 6,
        minDozens: 20,
      },
      {
        code: "MM03",
        name: "Bombay Mix Rs10",
        purchaseRate: 97,
        saleRate: 108,
        discountType: "AMOUNT_PER_UNIT",
        discountValue: 6,
        minDozens: 30,
      },
      {
        code: "MM04",
        name: "Pakora Crisps Rs10",
        purchaseRate: 97,
        saleRate: 108,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 30,
      },
      {
        code: "MM05",
        name: "Masala Papad Rs30",
        purchaseRate: 305,
        saleRate: 335,
        discountType: "NONE",
        discountValue: 0,
        minDozens: 10,
      },
    ],
  },
];

const AREAS = [
  { warehouse: "A", name: "Shahdara Town", sortOrder: 1 },
  { warehouse: "A", name: "Badami Bagh", sortOrder: 2 },
  { warehouse: "A", name: "Ravi Road", sortOrder: 3 },
  { warehouse: "B", name: "Township", sortOrder: 1 },
  { warehouse: "B", name: "Green Town", sortOrder: 2 },
] as const;

const FIRST_NAMES = [
  "Muhammad",
  "Ali",
  "Ahmed",
  "Hassan",
  "Zubair",
  "Naveed",
  "Asif",
  "Rizwan",
  "Faisal",
  "Shahid",
  "Tariq",
  "Nadeem",
  "Arshad",
  "Waqas",
  "Junaid",
];
const LAST_NAMES = [
  "Khan",
  "Butt",
  "Sheikh",
  "Chaudhry",
  "Rana",
  "Malik",
  "Mughal",
  "Ansari",
  "Qureshi",
  "Bhatti",
];
const SHOP_WORDS = [
  "General Store",
  "Kiryana Store",
  "Traders",
  "Mart",
  "Super Store",
  "Sweets & Bakers",
  "Cash & Carry",
  "Brothers",
];
const CUSTOMER_TYPES: CustomerType[] = [
  "RETAILER",
  "RETAILER",
  "RETAILER",
  "RETAILER",
  "WHOLESALER",
  "DEALER",
  "BIKE_SUPPLIER",
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Snacks Distributor",
      slug: "demo",
      address: "GT Road, Shahdara, Lahore",
      phone: "042-37001122",
    },
  });
  const tenantId = tenant.id;

  if ((await prisma.warehouse.count({ where: { tenantId } })) > 0) {
    console.log("Demo tenant already has data; nothing to do. Run `pnpm db:reset` to start over.");
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      const counters = new Map<string, number>();
      const nextNumber = (key: string) => {
        const value = (counters.get(key) ?? 0) + 1;
        counters.set(key, value);
        return value;
      };

      // ── Platform: users ──
      const passwordHash = await hashPassword(DEMO_PASSWORD);
      await tx.user.upsert({
        where: { email: "admin@platform.test" },
        update: {},
        create: {
          email: "admin@platform.test",
          name: "Platform Admin",
          role: "SUPER_ADMIN",
          passwordHash,
          mustChangePassword: false,
        },
      });
      const owner = await tx.user.create({
        data: {
          tenantId,
          email: "owner@demo.test",
          name: "Muhammad Laraib",
          role: "OWNER",
          passwordHash,
          mustChangePassword: false,
        },
      });
      await tx.user.create({
        data: {
          tenantId,
          email: "accountant@demo.test",
          name: "Ayesha Siddiqui",
          role: "ACCOUNTANT",
          passwordHash,
          mustChangePassword: false,
        },
      });
      const staffUser = await tx.user.create({
        data: {
          tenantId,
          email: "staff@demo.test",
          name: "Kamran Javed",
          role: "STAFF",
          passwordHash,
          mustChangePassword: false,
        },
      });
      const createdById = owner.id;

      // ── Units: packet is the base unit (12 to a dozen); rates are per dozen ──
      await tx.unitConversion.createMany({
        data: [
          { tenantId, baseUnit: "PACKET", unit: "PACKET", baseUnitsPerUnit: 1 },
          { tenantId, baseUnit: "PACKET", unit: "HALF_DOZEN", baseUnitsPerUnit: 6 },
          { tenantId, baseUnit: "PACKET", unit: "DOZEN", baseUnitsPerUnit: 12 },
        ],
      });

      // ── Expense categories (SPEC §9) ──
      await tx.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ tenantId, name })),
      });

      // ── Warehouses, areas ──
      const warehouseIds: Record<string, string> = {};
      for (const w of WAREHOUSES) {
        const row = await tx.warehouse.create({
          data: { tenantId, name: w.name, address: w.address },
        });
        warehouseIds[w.key] = row.id;
      }
      const areas: { id: string; warehouse: string }[] = [];
      for (const a of AREAS) {
        const row = await tx.area.create({
          data: {
            tenantId,
            warehouseId: warehouseIds[a.warehouse]!,
            name: a.name,
            sortOrder: a.sortOrder,
          },
        });
        areas.push({ id: row.id, warehouse: a.warehouse });
      }

      // ── Staff and bikes ──
      await tx.staff.create({
        data: {
          tenantId,
          userId: staffUser.id,
          name: "Kamran Javed",
          role: "OFFICE",
          phone: "0300-2223344",
          monthlySalary: 45000,
          joiningDate: day(-400),
        },
      });
      const drivers = [];
      for (const [i, name] of [
        "Akram Masih",
        "Shafiq Ahmed",
        "Riaz Hussain",
        "Saleem Gill",
      ].entries()) {
        drivers.push(
          await tx.staff.create({
            data: {
              tenantId,
              name,
              role: "DRIVER",
              phone: `0345-10020${i}${i}`,
              monthlySalary: 32000,
              joiningDate: day(-300 + i * 40),
            },
          }),
        );
      }
      const bikes = [];
      for (const [i, capacityDozens] of [100, 90, 80, 90].entries()) {
        bikes.push(
          await tx.bike.create({
            data: {
              tenantId,
              warehouseId: warehouseIds[i < 3 ? "A" : "B"]!,
              name: `Bike ${i + 1} (LEC-${4410 + i})`,
              capacity: dz(capacityDozens),
              driverId: drivers[i]!.id,
            },
          }),
        );
      }

      // ── Companies, products, price history, company opening balances ──
      type ProductRow = Awaited<ReturnType<typeof tx.product.create>> & {
        warehouseKey: string;
        tiers: DiscountTier[];
      };
      const products: ProductRow[] = [];
      const companies: {
        id: string;
        warehouseKey: string;
        paymentTermsDays: number;
        name: string;
      }[] = [];
      for (const c of COMPANIES) {
        const company = await tx.company.create({
          data: {
            tenantId,
            warehouseId: warehouseIds[c.warehouse]!,
            name: c.name,
            contactName: c.contactName,
            phone: c.phone,
            orderBookerName: c.orderBookerName,
            orderBookerPhone: c.orderBookerPhone,
            paymentTermsDays: c.paymentTermsDays,
            // Snacks come in sacks; each empty one sent back is credited on the next bill.
            sackRate: "150",
          },
        });
        companies.push({
          id: company.id,
          warehouseKey: c.warehouse,
          paymentTermsDays: c.paymentTermsDays,
          name: c.name,
        });

        await tx.ledgerEntry.create({
          data: {
            tenantId,
            partyType: "COMPANY",
            companyId: company.id,
            type: "OPENING_BALANCE",
            entryDate: day(-30),
            credit: c.openingBalance,
            description: "Opening balance",
            createdById,
          },
        });
        // The opening balance as a bill, so payments can be applied to it (oldest debt first).
        await tx.companyBill.create({
          data: {
            tenantId,
            number: nextNumber("COMPANY_BILL"),
            companyId: company.id,
            kind: "OPENING_BALANCE",
            billDate: day(-30),
            dueDate: day(-30),
            grossAmount: c.openingBalance,
            netAmount: c.openingBalance,
            createdById,
          },
        });

        for (const p of c.products) {
          const product = await tx.product.create({
            data: {
              tenantId,
              companyId: company.id,
              code: p.code,
              name: p.name,
              purchaseRate: p.purchaseRate,
              saleRate: p.saleRate,
              discountType: p.discountType,
              discountValue: p.discountValue,
              minStockLevel: dz(p.minDozens),
            },
          });
          const tiers: DiscountTier[] = (DISCOUNT_SLABS[p.code] ?? []).map((slab) => ({
            minQuantity: dz(slab.fromDozens),
            discountType: "AMOUNT_PER_UNIT",
            discountValue: slab.perDozen,
          }));
          if (tiers.length > 0) {
            await tx.productDiscountTier.createMany({
              data: tiers.map((tier) => ({ tenantId, productId: product.id, ...tier })),
            });
          }
          // An older rate (before slabs existed), then the current one, so history has something to show.
          await tx.productPriceHistory.createMany({
            data: [
              {
                tenantId,
                productId: product.id,
                purchaseRate: p.purchaseRate - 5,
                saleRate: p.saleRate - 5,
                discountType: p.discountType,
                discountValue: p.discountValue,
                effectiveFrom: day(-90),
                createdById,
              },
              {
                tenantId,
                productId: product.id,
                purchaseRate: p.purchaseRate,
                saleRate: p.saleRate,
                discountType: p.discountType,
                discountValue: p.discountValue,
                discountTiers: tiers,
                effectiveFrom: day(-20),
                createdById,
              },
            ],
          });
          products.push({ ...product, warehouseKey: c.warehouse, tiers });
        }
      }

      // ── Customers (30) with opening balances per company for some ──
      const customers: { id: string; warehouseKey: string }[] = [];
      const routeCounters = new Map<string, number>();
      for (let i = 0; i < 30; i++) {
        const area = areas[i % areas.length]!;
        const seq = (routeCounters.get(area.id) ?? 0) + 1;
        routeCounters.set(area.id, seq);
        const owner = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        const type = pick(CUSTOMER_TYPES);
        const phone = `03${between(0, 4)}${between(0, 9)}-${between(1000000, 9999999)}`;
        const customer = await tx.customer.create({
          data: {
            tenantId,
            areaId: area.id,
            routeSequence: seq,
            name: owner,
            shopName: `${owner.split(" ")[1]} ${pick(SHOP_WORDS)}`,
            type,
            phone,
            whatsapp: rand() < 0.8 ? phone : null,
            address: `Shop ${between(1, 250)}, ${AREAS[i % AREAS.length]!.name}, Lahore`,
            creditLimit: type === "RETAILER" ? 25000 : type === "BIKE_SUPPLIER" ? 50000 : 150000,
          },
        });
        customers.push({ id: customer.id, warehouseKey: area.warehouse });

        for (const company of companies.filter((c) => c.warehouseKey === area.warehouse)) {
          if (rand() < 0.5) continue;
          await tx.ledgerEntry.create({
            data: {
              tenantId,
              partyType: "CUSTOMER",
              customerId: customer.id,
              companyId: company.id,
              type: "OPENING_BALANCE",
              entryDate: day(-30),
              debit: between(5, 60) * 100,
              description: "Opening balance",
              createdById,
            },
          });
        }

        // Some customers still owe on paper bills from before the app: their old balance, owed
        // to us and not to any company (no companyId; CLAUDE.md rule 3 exception).
        if (i % 6 === 0) {
          const oldBill = await tx.customerOldBill.create({
            data: {
              tenantId,
              customerId: customer.id,
              billDate: day(-90),
              billNo: `K-${100 + i}`,
              amount: between(10, 80) * 100,
              createdById,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              tenantId,
              partyType: "CUSTOMER",
              customerId: customer.id,
              companyId: null,
              type: "OPENING_BALANCE",
              entryDate: oldBill.billDate,
              debit: oldBill.amount,
              description: `Old bill #${oldBill.billNo}`,
              referenceType: "CustomerOldBill",
              referenceId: oldBill.id,
              createdById,
            },
          });
        }
      }

      // ── Purchases: one PO + goods receipt + company bill per company (received 10 days ago) ──
      const batchByProduct = new Map<string, string>();
      for (const company of companies) {
        const companyProducts = products.filter((p) => p.companyId === company.id);
        const warehouseId = warehouseIds[company.warehouseKey]!;
        const orderDate = day(-12);
        const receivedDate = day(-10);

        const po = await tx.purchaseOrder.create({
          data: {
            tenantId,
            number: nextNumber("PURCHASE_ORDER"),
            companyId: company.id,
            warehouseId,
            orderDate,
            expectedDate: receivedDate,
            status: "RECEIVED",
            createdById,
          },
        });
        const receipt = await tx.goodsReceipt.create({
          data: {
            tenantId,
            number: nextNumber("GOODS_RECEIPT"),
            purchaseOrderId: po.id,
            companyId: company.id,
            warehouseId,
            receivedDate,
            supplierRef: `INV-${between(10000, 99999)}`,
            createdById,
          },
        });

        let billTotal = new Prisma.Decimal(0);
        for (const product of companyProducts) {
          const ordered = dz(between(6, 16) * 10);
          // Received sometimes differs from ordered (SPEC §4).
          const received = rand() < 0.2 ? ordered - dz(10) : ordered;
          const poLine = await tx.purchaseOrderLine.create({
            data: {
              tenantId,
              purchaseOrderId: po.id,
              productId: product.id,
              quantity: ordered,
              rate: product.purchaseRate,
            },
          });
          const { netAmount } = calculateLineAmounts({
            quantity: received,
            baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
            rate: product.purchaseRate,
          });
          billTotal = billTotal.add(netAmount);
          const receiptLine = await tx.goodsReceiptLine.create({
            data: {
              tenantId,
              goodsReceiptId: receipt.id,
              purchaseOrderLineId: poLine.id,
              productId: product.id,
              quantity: received,
              rate: product.purchaseRate,
              amount: netAmount,
            },
          });
          const batch = await tx.batch.create({
            data: {
              tenantId,
              productId: product.id,
              warehouseId,
              goodsReceiptLineId: receiptLine.id,
              receivedDate,
            },
          });
          batchByProduct.set(product.id, batch.id);
          await tx.stockMovement.create({
            data: {
              tenantId,
              type: "GOODS_RECEIPT",
              productId: product.id,
              warehouseId,
              batchId: batch.id,
              quantity: received,
              occurredAt: receivedDate,
              referenceType: "GoodsReceipt",
              referenceId: receipt.id,
              createdById,
            },
          });
        }

        const bill = await tx.companyBill.create({
          data: {
            tenantId,
            number: nextNumber("COMPANY_BILL"),
            companyId: company.id,
            goodsReceiptId: receipt.id,
            billDate: receivedDate,
            dueDate: day(-10 + company.paymentTermsDays),
            grossAmount: billTotal,
            netAmount: billTotal,
            createdById,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            partyType: "COMPANY",
            companyId: company.id,
            type: "COMPANY_BILL",
            entryDate: receivedDate,
            credit: billTotal,
            description: `Company bill #${bill.number}`,
            referenceType: "CompanyBill",
            referenceId: bill.id,
            createdById,
          },
        });

        // Partial payment on the first company's bill.
        if (company === companies[0]) {
          const amount = new Prisma.Decimal(100000);
          const payment = await tx.companyPayment.create({
            data: {
              tenantId,
              number: nextNumber("COMPANY_PAYMENT"),
              companyId: company.id,
              paymentDate: day(-3),
              method: "ONLINE",
              amount,
              reference: "IBFT-20391",
              createdById,
            },
          });
          await tx.companyPaymentAllocation.create({
            data: {
              tenantId,
              companyPaymentId: payment.id,
              companyBillId: bill.id,
              companyId: company.id,
              amount,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              tenantId,
              partyType: "COMPANY",
              companyId: company.id,
              type: "COMPANY_PAYMENT",
              entryDate: day(-3),
              debit: amount,
              description: `Payment #${payment.number} (online)`,
              referenceType: "CompanyPayment",
              referenceId: payment.id,
              createdById,
            },
          });
        }
      }

      // ── Sales orders ──
      const snapshotLine = (l: {
        productId: string;
        companyId: string;
        quantity: number;
        rate: Prisma.Decimal;
        discountType: string;
        discountValue: Prisma.Decimal;
        grossAmount: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        netAmount: Prisma.Decimal;
      }) => ({
        productId: l.productId,
        companyId: l.companyId,
        quantity: l.quantity,
        rate: l.rate.toFixed(2),
        discountType: l.discountType,
        discountValue: l.discountValue.toFixed(2),
        grossAmount: l.grossAmount.toFixed(2),
        discountAmount: l.discountAmount.toFixed(2),
        taxAmount: l.taxAmount.toFixed(2),
        netAmount: l.netAmount.toFixed(2),
      });

      async function createOrder(options: {
        customerId: string;
        warehouseKey: string;
        orderDate: Date;
        deliveryDate: Date;
        status: "BOOKED" | "DELIVERED";
        lineCount: number;
        /** Fixed lines (product code → dozens) instead of random ones. */
        fixedLines?: Record<string, number>;
      }) {
        const candidates = products.filter((p) => p.warehouseKey === options.warehouseKey);
        const chosen = new Map<ProductRow, number>();
        if (options.fixedLines) {
          for (const [code, dozens] of Object.entries(options.fixedLines)) {
            chosen.set(
              candidates.find((p) => p.code === code)!,
              dz(dozens),
            );
          }
        }
        while (chosen.size < Math.min(options.lineCount, candidates.length)) {
          const product = pick(candidates);
          // 1 to 6 dozen, in half dozens (quantities are packets).
          if (!chosen.has(product)) chosen.set(product, dz(between(2, 12) / 2));
        }

        const order = await tx.salesOrder.create({
          data: {
            tenantId,
            number: nextNumber("SALES_ORDER"),
            customerId: options.customerId,
            warehouseId: warehouseIds[options.warehouseKey]!,
            orderDate: options.orderDate,
            deliveryDate: options.deliveryDate,
            status: options.status,
            source: "OFFICE",
            createdById: staffUser.id,
          },
        });
        const lines: Awaited<ReturnType<typeof tx.salesOrderLine.create>>[] = [];
        for (const [product, quantity] of chosen) {
          const discount = resolveDiscount(product, product.tiers, quantity);
          const amounts = calculateLineAmounts({
            quantity,
            baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
            rate: product.saleRate,
            ...discount,
          });
          lines.push(
            await tx.salesOrderLine.create({
              data: {
                tenantId,
                salesOrderId: order.id,
                productId: product.id,
                companyId: product.companyId,
                quantity,
                rate: product.saleRate,
                ...discount,
                ...amounts,
              },
            }),
          );
        }
        if (options.status === "BOOKED") {
          // One bill per order, created at booking; it posts to the ledger at dispatch.
          const totals = sumLineAmounts(lines);
          const bill = await tx.bill.create({
            data: {
              tenantId,
              number: nextNumber("BILL"),
              salesOrderId: order.id,
              customerId: options.customerId,
              billDate: options.deliveryDate,
              ...totals,
            },
          });
          const companyIds = [...new Set(lines.map((l) => l.companyId))];
          await tx.billRevision.create({
            data: {
              tenantId,
              billId: bill.id,
              revision: 1,
              reason: "Booked",
              ...totals,
              lines: lines.map(snapshotLine),
              companyTotals: companyIds.map((companyId) => {
                const t = sumLineAmounts(lines.filter((l) => l.companyId === companyId));
                return {
                  companyId,
                  netAmount: t.netAmount.toFixed(2),
                  quantity: lines
                    .filter((l) => l.companyId === companyId)
                    .reduce((q, l) => q + l.quantity, 0),
                };
              }),
              createdById: staffUser.id,
            },
          });
        }
        return { order, lines };
      }

      // One delivered order from two days ago: bill, dispatch, payment, and a damage claim.
      const deliveredCustomer = customers.find((c) => c.warehouseKey === "A")!;
      const delivered = await createOrder({
        customerId: deliveredCustomer.id,
        warehouseKey: "A",
        orderDate: day(-3),
        deliveryDate: day(-2),
        status: "DELIVERED",
        lineCount: 5,
      });
      const totals = sumLineAmounts(delivered.lines);
      const byCompany = new Map<string, typeof totals>();
      for (const companyId of new Set(delivered.lines.map((l) => l.companyId))) {
        byCompany.set(
          companyId,
          sumLineAmounts(delivered.lines.filter((l) => l.companyId === companyId)),
        );
      }
      const previous = await tx.ledgerEntry.aggregate({
        where: { tenantId, partyType: "CUSTOMER", customerId: deliveredCustomer.id },
        _sum: { debit: true, credit: true },
      });
      const previousBalance = (previous._sum.debit ?? new Prisma.Decimal(0)).sub(
        previous._sum.credit ?? 0,
      );
      const bill = await tx.bill.create({
        data: {
          tenantId,
          number: nextNumber("BILL"),
          salesOrderId: delivered.order.id,
          customerId: deliveredCustomer.id,
          billDate: day(-2),
          ...totals,
          previousBalance,
          postedAt: day(-2),
        },
      });
      const previousByCompany = await tx.ledgerEntry.groupBy({
        by: ["companyId"],
        where: { tenantId, partyType: "CUSTOMER", customerId: deliveredCustomer.id },
        _sum: { debit: true, credit: true },
      });
      const previousFor = (companyId: string) => {
        const g = previousByCompany.find((p) => p.companyId === companyId);
        return (g?._sum.debit ?? new Prisma.Decimal(0)).sub(g?._sum.credit ?? 0).toFixed(2);
      };
      await tx.billRevision.create({
        data: {
          tenantId,
          billId: bill.id,
          revision: 1,
          reason: "Booked",
          ...totals,
          lines: delivered.lines.map(snapshotLine),
          companyTotals: [...byCompany].map(([companyId, t]) => ({
            companyId,
            netAmount: t.netAmount.toFixed(2),
          })),
          createdById,
        },
      });
      // Frozen at dispatch: what the customer owed each company before this bill.
      await tx.bill.update({
        where: { id: bill.id },
        data: {
          previousByCompany: previousByCompany
            .filter((g) => g.companyId)
            .map((g) => ({ companyId: g.companyId!, amount: previousFor(g.companyId!) })),
        },
      });
      // It went out on Bike 1, and day-end was entered for it.
      const pastTrip = await tx.deliveryTrip.create({
        data: {
          tenantId,
          number: nextNumber("DELIVERY_TRIP"),
          tripDate: day(-2),
          warehouseId: warehouseIds.A!,
          bikeId: bikes[0]!.id,
          driverId: drivers[0]!.id,
          status: "RECONCILED",
          dispatchedAt: day(-2),
          reconciledAt: day(-2),
          createdById,
        },
      });
      await tx.salesOrder.update({
        where: { id: delivered.order.id },
        data: {
          tripId: pastTrip.id,
          status: "PARTIALLY_DELIVERED",
          reconciledAt: day(-2),
          reconciledById: createdById,
        },
      });
      for (const [companyId, t] of byCompany) {
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            partyType: "CUSTOMER",
            customerId: deliveredCustomer.id,
            companyId,
            type: "SALES_BILL",
            entryDate: day(-2),
            debit: t.netAmount,
            description: `Bill #${bill.number}`,
            referenceType: "Bill",
            referenceId: bill.id,
            createdById,
          },
        });
      }
      for (const line of delivered.lines) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            type: "DISPATCH",
            productId: line.productId,
            warehouseId: warehouseIds.A!,
            batchId: batchByProduct.get(line.productId),
            quantity: -line.quantity,
            occurredAt: day(-2),
            referenceType: "SalesOrder",
            referenceId: delivered.order.id,
            createdById,
          },
        });
      }

      // Cash collected at delivery: half the bill, split across companies in proportion.
      const collected = totals.netAmount.div(2).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
      const payment = await tx.customerPayment.create({
        data: {
          tenantId,
          number: nextNumber("CUSTOMER_PAYMENT"),
          customerId: deliveredCustomer.id,
          paymentDate: day(-2),
          method: "CASH",
          amount: collected,
          collectedVia: "DELIVERY",
          salesOrderId: delivered.order.id,
          createdById,
        },
      });
      let allocated = new Prisma.Decimal(0);
      const companySlices = [...byCompany];
      for (const [index, [companyId, t]] of companySlices.entries()) {
        const amount =
          index === companySlices.length - 1
            ? collected.sub(allocated)
            : collected
                .mul(t.netAmount)
                .div(totals.netAmount)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        allocated = allocated.add(amount);
        await tx.paymentAllocation.create({
          data: { tenantId, customerPaymentId: payment.id, billId: bill.id, companyId, amount },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            partyType: "CUSTOMER",
            customerId: deliveredCustomer.id,
            companyId,
            type: "CUSTOMER_PAYMENT",
            entryDate: day(-2),
            credit: amount,
            description: `Cash received, payment #${payment.number}`,
            referenceType: "CustomerPayment",
            referenceId: payment.id,
            createdById,
          },
        });
      }

      // One half dozen damaged in that delivery → damaged stock, claim against the company, and
      // the bill revised at day-end (the customer is not charged for it).
      const damagedLine = delivered.lines[0]!;
      const damagedProduct = products.find((p) => p.id === damagedLine.productId)!;
      await tx.stockMovement.create({
        data: {
          tenantId,
          type: "DELIVERY_DAMAGE",
          productId: damagedProduct.id,
          warehouseId: warehouseIds.A!,
          batchId: batchByProduct.get(damagedProduct.id),
          bucket: "DAMAGED",
          quantity: 1,
          occurredAt: day(-2),
          referenceType: "SalesOrder",
          referenceId: delivered.order.id,
          createdById,
        },
      });
      const claimAmount = calculateLineAmounts({
        quantity: 1,
        baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
        rate: damagedProduct.purchaseRate,
      }).netAmount;
      const claim = await tx.companyClaim.create({
        data: {
          tenantId,
          number: nextNumber("COMPANY_CLAIM"),
          companyId: damagedProduct.companyId,
          productId: damagedProduct.id,
          type: "DELIVERY_DAMAGE",
          claimDate: day(-2),
          quantity: 1,
          rate: damagedProduct.purchaseRate,
          amount: claimAmount,
          salesOrderId: delivered.order.id,
          note: "Packets crushed in delivery",
          createdById,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "COMPANY",
          companyId: damagedProduct.companyId,
          type: "COMPANY_CLAIM",
          entryDate: day(-2),
          debit: claimAmount,
          description: `Damage claim #${claim.number}`,
          referenceType: "CompanyClaim",
          referenceId: claim.id,
          createdById,
        },
      });

      await tx.salesOrderLine.update({
        where: { id: damagedLine.id },
        data: { damagedQuantity: 1 },
      });
      const keptLines = delivered.lines.map((l) => {
        if (l.id !== damagedLine.id) return l;
        return {
          ...l,
          quantity: l.quantity - 1,
          ...calculateLineAmounts({
            quantity: l.quantity - 1,
            baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
            rate: l.rate,
            discountType: l.discountType,
            discountValue: l.discountValue,
          }),
        };
      });
      const keptTotals = sumLineAmounts(keptLines);
      await tx.bill.update({
        where: { id: bill.id },
        data: { currentRevision: 2, ...keptTotals },
      });
      await tx.billRevision.create({
        data: {
          tenantId,
          billId: bill.id,
          revision: 2,
          reason: `Day-end: ${damagedProduct.name} damaged 0.5 dz`,
          ...keptTotals,
          lines: keptLines.map(snapshotLine),
          companyTotals: [...new Set(keptLines.map((l) => l.companyId))].map((companyId) => ({
            companyId,
            netAmount: sumLineAmounts(
              keptLines.filter((l) => l.companyId === companyId),
            ).netAmount.toFixed(2),
          })),
          createdById,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          tenantId,
          partyType: "CUSTOMER",
          customerId: deliveredCustomer.id,
          companyId: damagedLine.companyId,
          type: "BILL_REVISION",
          entryDate: day(-2),
          credit: totals.netAmount.sub(keptTotals.netAmount),
          description: `Bill #${bill.number} revised at day-end (returns / damage)`,
          referenceType: "Bill",
          referenceId: bill.id,
          createdById,
        },
      });

      // Booked orders for tomorrow (they reserve stock; no movement until dispatch).
      for (const customer of customers.slice(1, 13)) {
        await createOrder({
          customerId: customer.id,
          warehouseKey: customer.warehouseKey,
          orderDate: day(0),
          deliveryDate: day(1),
          status: "BOOKED",
          lineCount: between(2, 5),
        });
      }

      // A wholesale order big enough to reach discount slabs.
      const wholesaler = await tx.customer.findFirstOrThrow({
        where: {
          tenantId,
          type: { in: ["WHOLESALER", "DEALER"] },
          area: { warehouseId: warehouseIds.A! },
        },
      });
      await createOrder({
        customerId: wholesaler.id,
        warehouseKey: "A",
        orderDate: day(0),
        deliveryDate: day(1),
        status: "BOOKED",
        lineCount: 3,
        fixedLines: { CB07: 30, GC01: 25 },
      });

      // One pending stock adjustment waiting for the owner.
      await tx.stockAdjustment.create({
        data: {
          tenantId,
          productId: products[4]!.id,
          warehouseId: warehouseIds.A!,
          quantity: -dz(1),
          reason: "COUNTING_ERROR",
          note: "Physical count 1 dozen short",
          requestedById: staffUser.id,
        },
      });

      // ── Expenses (SPEC §9): petrol per bike for the last few days, rent, labour ──
      const category = new Map(
        (await tx.expenseCategory.findMany({ where: { tenantId } })).map((c) => [c.name, c.id]),
      );
      const expense = (
        offset: number,
        name: string,
        amount: number,
        extra: { bikeId?: string; tripId?: string; paidTo?: string; note?: string } = {},
      ) =>
        tx.expense.create({
          data: {
            tenantId,
            number: nextNumber("EXPENSE"),
            expenseDate: day(offset),
            categoryId: category.get(name)!,
            amount,
            createdById,
            ...extra,
          },
        });
      for (const offset of [-3, -2, -1]) {
        for (const bike of bikes) {
          await expense(offset, "Petrol", between(6, 12) * 100, { bikeId: bike.id });
        }
      }
      await expense(-2, "Petrol", 900, { bikeId: bikes[0]!.id, tripId: pastTrip.id });
      await expense(-20, "Rent", 45000, { paidTo: "Warehouse A landlord" });
      await expense(-1, "Loading labour", 1500, { note: "Unloading company delivery" });
      await expense(-1, "Utilities", 6200, { paidTo: "LESCO", note: "Electricity bill" });

      await tx.documentSequence.createMany({
        data: [...counters].map(([key, last]) => ({ tenantId, key, nextValue: last + 1 })),
      });
    },
    { timeout: 60_000 },
  );

  const counts = {
    products: await prisma.product.count({ where: { tenantId } }),
    customers: await prisma.customer.count({ where: { tenantId } }),
    salesOrders: await prisma.salesOrder.count({ where: { tenantId } }),
    ledgerEntries: await prisma.ledgerEntry.count({ where: { tenantId } }),
    stockMovements: await prisma.stockMovement.count({ where: { tenantId } }),
  };
  console.log(`Seeded "${tenant.name}":`, counts);
  console.log(
    `Logins (password ${DEMO_PASSWORD}): owner@demo.test, accountant@demo.test, staff@demo.test, admin@platform.test`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
