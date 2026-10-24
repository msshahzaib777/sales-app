import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  allocateByCompany,
  allocateOldestFirst,
  type BillDebt,
  checkCompanySplit,
  effectiveDebt,
} from "./payments";

const owed = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, v]));
const fixed = (m: Map<string, Decimal>) =>
  Object.fromEntries([...m].map(([k, v]) => [k, v.toFixed(2)]));
const allocs = (a: { billId: string; companyId: string; amount: Decimal }[]) =>
  a.map((x) => `${x.billId}/${x.companyId}=${x.amount.toFixed(2)}`);

// Bill 1 (older): A 600, B 400. Bill 2: A 1000.
const bills: BillDebt[] = [
  {
    billId: "b1",
    number: 1,
    slices: [
      { companyId: "A", outstanding: "600" },
      { companyId: "B", outstanding: "400" },
    ],
  },
  { billId: "b2", number: 2, slices: [{ companyId: "A", outstanding: "1000" }] },
];

describe("what the customer owes, bill by bill", () => {
  it("treats ledger balance above the open bills as opening balance", () => {
    const d = effectiveDebt(owed({ A: "1900", B: "400" }), bills);
    expect(fixed(d.unbilled)).toEqual({ A: "300.00" });
    expect(d.bills).toHaveLength(2);
  });

  it("uses an earlier advance to pay off the oldest slices", () => {
    const d = effectiveDebt(owed({ A: "1300", B: "400" }), bills);
    expect(d.unbilled.size).toBe(0);
    // A owes 1300 of 1600 in slices: 300 credit clears the oldest A slice down to 300.
    expect(d.bills[0]!.slices.map((s) => [s.companyId, D(s.outstanding)])).toEqual([
      ["A", "300.00"],
      ["B", "400.00"],
    ]);
  });
});

const D = (v: Decimal | string | number) => new Decimal(v).toFixed(2);

describe("oldest debt first", () => {
  it("pays opening balance, then the oldest bill in full, then part of the next", () => {
    const debt = effectiveDebt(owed({ A: "1900", B: "400" }), bills);
    const s = allocateOldestFirst("1500", debt, []);
    expect(fixed(s.byCompany)).toEqual({ A: "1100.00", B: "400.00" });
    expect(allocs(s.allocations)).toEqual(["b1/A=600.00", "b1/B=400.00", "b2/A=200.00"]);
    expect(s.advance.toFixed(2)).toBe("0.00");
  });

  it("splits part of a multi-company bill by each company's unpaid amount", () => {
    const s = allocateOldestFirst("500", effectiveDebt(owed({ A: "1600", B: "400" }), bills), []);
    expect(allocs(s.allocations)).toEqual(["b1/A=300.00", "b1/B=200.00"]);
  });

  it("keeps an overpayment as an advance with the given companies", () => {
    const s = allocateOldestFirst("2100", effectiveDebt(owed({ A: "1600", B: "400" }), bills), [
      ["A", "1"],
    ]);
    expect(s.advance.toFixed(2)).toBe("100.00");
    expect(fixed(s.byCompany)).toEqual({ A: "1700.00", B: "400.00" });
  });
});

describe("manual split by company", () => {
  it("pays each company's opening balance and oldest slices", () => {
    const debt = effectiveDebt(owed({ A: "1900", B: "400" }), bills);
    const s = allocateByCompany(owed({ A: "1000", B: "500" }), debt);
    expect(allocs(s.allocations)).toEqual(["b1/A=600.00", "b2/A=100.00", "b1/B=400.00"]);
    expect(s.advance.toFixed(2)).toBe("100.00");
    expect(fixed(s.byCompany)).toEqual({ A: "1000.00", B: "500.00" });
  });

  it("must add up to the payment", () => {
    expect(checkCompanySplit("1500", owed({ A: "1000", B: "500" }))).toEqual([]);
    expect(checkCompanySplit("1500", owed({ A: "1000" }))[0]).toMatch(/add up to 1000.00/);
    expect(checkCompanySplit("0", owed({ A: "-5", B: "5" }))[0]).toMatch(/negative/);
  });
});
