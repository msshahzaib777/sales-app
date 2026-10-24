import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { runAction } from "./actions";
import { ServiceError } from "./services/errors";

describe("runAction", () => {
  it("turns a concurrent-write abort into a 'try again' message and keeps the typed values", async () => {
    const form = new FormData();
    form.set("amount", "500");
    const conflict = new Prisma.PrismaClientKnownRequestError("could not serialize access", {
      code: "P2034",
      clientVersion: "test",
    });
    const result = await runAction(async () => {
      throw conflict;
    }, form);
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/try again/),
      values: { amount: "500" },
    });
  });

  it("shows business-rule errors and rethrows anything unexpected", async () => {
    expect(
      await runAction(async () => {
        throw new ServiceError("Not enough stock.");
      }),
    ).toMatchObject({ status: "error", message: "Not enough stock." });
    await expect(
      runAction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
