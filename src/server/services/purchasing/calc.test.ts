import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import {
  addDays,
  allocateOldestFirst,
  billState,
  checkAllocations,
  claimsToDeduct,
  dueText,
  purchaseOrderStatus,
  runningPayable,
} from "./calc";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const D = (v: string | number) => new Prisma.Decimal(v);
const bills = [
  { id: "b2", number: 2, billDate: d("2026-10-05"), dueDate: d("2026-10-20"), outstanding: "3000" },
  {
    id: "b1",
    number: 1,
    billDate: d("2026-10-01"),
    dueDate: d("2026-10-16"),
    outstanding: "1000.50",
  },
  { id: "b3", number: 3, billDate: d("2026-10-10"), dueDate: d("2026-10-25"), outstanding: "500" },
];
const simple = (a: { billId: string; amount: Prisma.Decimal }[]) =>
  a.map((x) => [x.billId, x.amount.toFixed(2)]);

describe("allocateOldestFirst", () => {
  it("pays the oldest due bills first and splits the last one", () => {
    expect(simple(allocateOldestFirst("2500", bills))).toEqual([
      ["b1", "1000.50"],
      ["b2", "1499.50"],
    ]);
  });

  it("leaves any extra unallocated", () => {
    expect(simple(allocateOldestFirst("10000", bills)).map(([, a]) => a)).toEqual([
      "1000.50",
      "3000.00",
      "500.00",
    ]);
  });

  it("skips settled bills", () => {
    expect(
      simple(allocateOldestFirst("100", [{ ...bills[1]!, outstanding: "0" }, bills[0]!])),
    ).toEqual([["b2", "100.00"]]);
  });
});

describe("checkAllocations", () => {
  it("accepts a manual split within the payment and the bills", () => {
    expect(
      checkAllocations(
        "1500",
        [
          { billId: "b3", amount: D(500) },
          { billId: "b2", amount: D(1000) },
        ],
        bills,
      ),
    ).toEqual([]);
  });

  it("rejects over-allocation, unknown bills, duplicates and non-positive amounts", () => {
    expect(checkAllocations("100", [{ billId: "b3", amount: D(600) }], bills)).toEqual([
      "Bill #3 only has 500.00 outstanding.",
      "The allocations (600.00) are more than the payment (100.00).",
    ]);
    expect(checkAllocations("100", [{ billId: "zz", amount: D(1) }], bills)).toEqual([
      "A payment can only be applied to this company's open bills.",
    ]);
    expect(
      checkAllocations(
        "100",
        [
          { billId: "b3", amount: D(10) },
          { billId: "b3", amount: D(0) },
        ],
        bills,
      ),
    ).toEqual(["Bill #3 appears twice.", "The amount for bill #3 must be more than zero."]);
  });
});

describe("billState", () => {
  const bill = { netAmount: "1000", dueDate: d("2026-10-20"), status: "POSTED" as const };

  it("unpaid, partial, paid", () => {
    expect(billState(bill, "0", d("2026-10-18"))).toMatchObject({
      status: "UNPAID",
      overdue: false,
      daysOverdue: -2,
    });
    expect(billState(bill, "400", d("2026-10-25"))).toMatchObject({
      status: "PARTIAL",
      overdue: true,
      daysOverdue: 5,
    });
    expect(billState(bill, "400", d("2026-10-25")).outstanding.toFixed(2)).toBe("600.00");
    expect(billState(bill, "1000", d("2026-11-30"))).toMatchObject({
      status: "PAID",
      overdue: false,
    });
  });

  it("is never overdue on the due date itself", () => {
    expect(billState(bill, "0", d("2026-10-20"))).toMatchObject({ overdue: false, daysOverdue: 0 });
  });

  it("reversed bills owe nothing", () => {
    expect(billState({ ...bill, status: "REVERSED" }, "0", d("2026-12-01"))).toMatchObject({
      status: "REVERSED",
      overdue: false,
    });
  });
});

describe("dueText", () => {
  it("describes due dates like the daily report", () => {
    expect(dueText(5)).toBe("due 5 days ago");
    expect(dueText(1)).toBe("due 1 day ago");
    expect(dueText(0)).toBe("due today");
    expect(dueText(-3)).toBe("due in 3 days");
  });
});

describe("claimsToDeduct", () => {
  const claims = [
    { id: "c2", number: 2, claimDate: d("2026-10-05"), amount: "700" },
    { id: "c1", number: 1, claimDate: d("2026-10-01"), amount: "300" },
    { id: "c3", number: 3, claimDate: d("2026-10-06"), amount: "100" },
  ];

  it("deducts whole claims, oldest first, up to the bill amount", () => {
    expect(claimsToDeduct("500", claims)).toMatchObject({ ids: ["c1", "c3"] });
    expect(claimsToDeduct("500", claims).total.toFixed(2)).toBe("400.00");
    expect(claimsToDeduct("5000", claims).ids).toEqual(["c1", "c2", "c3"]);
    expect(claimsToDeduct("50", claims).ids).toEqual([]);
  });
});

describe("purchaseOrderStatus", () => {
  it("follows received quantities, including over-delivery", () => {
    expect(purchaseOrderStatus("OPEN", [{ ordered: 10, received: 0 }])).toBe("OPEN");
    expect(
      purchaseOrderStatus("OPEN", [
        { ordered: 10, received: 4 },
        { ordered: 5, received: 0 },
      ]),
    ).toBe("PARTIALLY_RECEIVED");
    expect(purchaseOrderStatus("PARTIALLY_RECEIVED", [{ ordered: 10, received: 12 }])).toBe(
      "RECEIVED",
    );
    expect(purchaseOrderStatus("CLOSED", [{ ordered: 10, received: 4 }])).toBe("CLOSED");
  });
});

describe("addDays and runningPayable", () => {
  it("computes due dates", () => {
    expect(addDays(d("2026-10-24"), 15).toISOString().slice(0, 10)).toBe("2026-11-08");
  });

  it("bills raise and payments/claims lower what we owe", () => {
    const rows = runningPayable("1000", [
      { credit: "5000", debit: "0" },
      { credit: "0", debit: "2000" },
      { credit: "0", debit: "250.50" },
    ]);
    expect(rows.map((r) => r.balance.toFixed(2))).toEqual(["6000.00", "4000.00", "3749.50"]);
  });
});
