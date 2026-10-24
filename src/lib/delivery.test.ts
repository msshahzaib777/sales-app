import { describe, expect, it } from "vitest";

import {
  byRoute,
  checkLineResults,
  deliveredLines,
  deliveryStatus,
  loadByProduct,
  splitByWeight,
  takeFromBatches,
} from "./delivery";

const chips = {
  productId: "p1",
  companyId: "c1",
  quantity: 120, // 10 dozen
  rate: "228",
  discountType: "AMOUNT_PER_UNIT" as const,
  discountValue: "8",
};
const nimko = {
  productId: "p2",
  companyId: "c2",
  quantity: 24,
  rate: "230",
  discountType: "NONE" as const,
  discountValue: "0",
};

describe("day-end quantities", () => {
  it("accepts returns and damage up to what was sent", () => {
    expect(checkLineResults([chips], [{ productId: "p1", returned: 24, damaged: 12 }])).toEqual([]);
    expect(checkLineResults([chips], [{ productId: "p1", returned: 90, damaged: 36 }])[0]).toMatch(
      /more than/,
    );
    expect(checkLineResults([chips], [{ productId: "p1", returned: -1, damaged: 0 }])).toHaveLength(
      1,
    );
    expect(checkLineResults([chips], [{ productId: "zz", returned: 1, damaged: 0 }])[0]).toMatch(
      /not on this order/,
    );
  });

  it("re-prices lines on what was kept, at the booked rate and per-dozen discount", () => {
    const lines = deliveredLines(
      [chips, nimko],
      [
        { productId: "p1", returned: 24, damaged: 6 }, // 7.5 dozen kept
        { productId: "p2", returned: 24, damaged: 0 }, // all back
      ],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: "p1", quantity: 90 });
    expect(lines[0]!.grossAmount.toFixed(2)).toBe("1710.00"); // 7.5 × 228
    expect(lines[0]!.discountAmount.toFixed(2)).toBe("60.00"); // 7.5 × 8
    expect(lines[0]!.netAmount.toFixed(2)).toBe("1650.00");
  });

  it("re-prices loose packets kept", () => {
    const [line] = deliveredLines([chips], [{ productId: "p1", returned: 1, damaged: 2 }]);
    // 117 packets = 9.75 dozen × (228 − 8)
    expect([line!.quantity, line!.netAmount.toFixed(2)]).toEqual([117, "2145.00"]);
  });

  it("works out the order status", () => {
    expect(deliveryStatus([chips, nimko], [])).toBe("DELIVERED");
    expect(deliveryStatus([chips, nimko], [{ productId: "p2", returned: 0, damaged: 1 }])).toBe(
      "PARTIALLY_DELIVERED",
    );
    expect(
      deliveryStatus(
        [chips, nimko],
        [
          { productId: "p1", returned: 120, damaged: 0 },
          { productId: "p2", returned: 23, damaged: 1 },
        ],
      ),
    ).toBe("RETURNED");
  });
});

describe("splitting a payment by company", () => {
  it("splits in proportion and always adds up to the paisa", () => {
    const parts = splitByWeight("1000", [
      ["a", "1"],
      ["b", "1"],
      ["c", "1"],
    ]);
    expect([...parts.values()].map((v) => v.toFixed(2))).toEqual(["333.33", "333.33", "333.34"]);
  });

  it("ignores companies with nothing owed and falls back to the first key", () => {
    expect(
      [
        ...splitByWeight("500", [
          ["a", "-200"],
          ["b", "300"],
        ]),
      ].map(([k, v]) => [k, v.toFixed(2)]),
    ).toEqual([["b", "500.00"]]);
    expect(
      splitByWeight("500", [
        ["a", "0"],
        ["b", "-1"],
      ])
        .get("a")!
        .toFixed(2),
    ).toBe("500.00");
  });
});

describe("stock out", () => {
  it("takes from the oldest batches first", () => {
    expect(
      takeFromBatches(10, [
        { id: "old", available: 6 },
        { id: "empty", available: 0 },
        { id: "new", available: 8 },
      ]),
    ).toEqual({
      slices: [
        { batchId: "old", quantity: 6 },
        { batchId: "new", quantity: 4 },
      ],
      unbatched: 0,
    });
    expect(takeFromBatches(5, [{ id: "b", available: 2 }]).unbatched).toBe(3);
  });

  it("adds up a trip's load per product", () => {
    expect([...loadByProduct([chips, nimko, { productId: "p1", quantity: 3 }])]).toEqual([
      ["p1", 123],
      ["p2", 24],
    ]);
  });
});

describe("visiting order", () => {
  it("goes by area route order, then place on the route, then name", () => {
    const stop = (name: string, area: [string, number] | null, routeSequence: number | null) => ({
      customer: { name, routeSequence, area: area ? { name: area[0], sortOrder: area[1] } : null },
    });
    const stops = [
      stop("Zahid", ["Ravi Road", 2], null),
      stop("Bilal", ["Shahdara", 1], 2),
      stop("Asif", ["Shahdara", 1], null),
      stop("Kamran", ["Shahdara", 1], 1),
      stop("No area", null, null),
    ];
    expect([...stops].sort(byRoute).map((s) => s.customer.name)).toEqual([
      "Kamran",
      "Bilal",
      "Asif",
      "Zahid",
      "No area",
    ]);
  });
});
