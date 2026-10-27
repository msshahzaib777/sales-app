import { describe, expect, it } from "vitest";

import { localPhone, normalizePkPhone, phoneSearchDigits } from "./phone";

describe("normalizePkPhone", () => {
  it("stores every way of typing a number as +92 and the national number", () => {
    for (const typed of [
      "0300-1234567",
      "03001234567",
      "3001234567",
      "300 1234567",
      "+92 300 1234567",
      "+923001234567",
      "923001234567",
      "0092 300 1234567",
      " (0300) 123-4567 ",
    ])
      expect(normalizePkPhone(typed)).toBe("+92 3001234567");
    expect(normalizePkPhone("042-37001122")).toBe("+92 4237001122");
  });

  it("refuses text, numbers too short or long, and other countries", () => {
    for (const bad of ["call me", "12345", "0300-12345678901", "+44 20 7946 0958", "00"])
      expect(normalizePkPhone(bad)).toBeNull();
  });
});

describe("phone search", () => {
  it("looks for the digits of a number-like word, whatever prefix it was typed with", () => {
    expect(phoneSearchDigits("0300-123")).toBe("300123");
    expect(phoneSearchDigits("+92300")).toBe("300");
    expect(phoneSearchDigits("4567")).toBe("4567");
    expect(phoneSearchDigits("ali")).toBeNull();
    expect(phoneSearchDigits("12")).toBeNull();
  });

  it("shows a stored number the way it is usually typed, for pickers", () => {
    expect(localPhone("+92 3001234567")).toBe("03001234567");
    expect(localPhone(null)).toBeNull();
  });
});
