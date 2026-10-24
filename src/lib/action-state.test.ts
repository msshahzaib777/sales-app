import { describe, expect, it } from "vitest";

import { echoValues, submittedValue } from "./action-state";

describe("echoValues", () => {
  it("returns typed text values but never passwords or Next.js internals", () => {
    const form = new FormData();
    form.set("email", "owner@demo.test");
    form.set("password", "secret1");
    form.set("newPassword", "secret2");
    form.set("$ACTION_ID_abc", "");
    expect(echoValues(form)).toEqual({ email: "owner@demo.test", "email.0": "owner@demo.test" });
  });

  it("keeps repeated fields row by row", () => {
    const form = new FormData();
    form.append("slabFrom", "25");
    form.append("slabFrom", "50");
    expect(echoValues(form)).toMatchObject({
      slabFrom: "25",
      "slabFrom.0": "25",
      "slabFrom.1": "50",
    });
  });
});

describe("submittedValue", () => {
  it("reads echoed values from an error state only", () => {
    expect(submittedValue({ status: "error", message: "x", values: { name: "Ali" } }, "name")).toBe(
      "Ali",
    );
    expect(submittedValue({ status: "idle" }, "name")).toBeUndefined();
  });
});
