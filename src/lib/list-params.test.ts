import { describe, expect, it } from "vitest";

import { matchEveryWord, searchNumber, searchWhere, searchWords } from "./list-params";

describe("search", () => {
  it("splits the box into words", () => {
    expect(searchWords("  kh   ali ")).toEqual(["kh", "ali"]);
    expect(searchWords("")).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
  });

  it("needs every word, each in any field", () => {
    expect(searchWhere("kh ali", ["name", "shopName"])).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: "kh", mode: "insensitive" } },
            { shopName: { contains: "kh", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { name: { contains: "ali", mode: "insensitive" } },
            { shopName: { contains: "ali", mode: "insensitive" } },
          ],
        },
      ],
    });
    expect(matchEveryWord(" ", (w) => [w])).toEqual({});
  });

  it("reads a document number with or without #", () => {
    expect(searchNumber("12")).toBe(12);
    expect(searchNumber("#12")).toBe(12);
    expect(searchNumber("12 ali")).toBeUndefined();
  });
});
