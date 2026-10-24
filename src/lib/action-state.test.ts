import { describe, expect, it } from "vitest";

import { echoValues, submittedValue } from "./action-state";

describe("echoValues", () => {
  it("returns typed text values but never passwords or Next.js internals", () => {
    const form = new FormData();
    form.set("email", "owner@demo.test");
    form.set("password", "secret1");
    form.set("newPassword", "secret2");
    form.set("$ACTION_ID_abc", "");
    expect(echoValues(form)).toEqual({ email: "owner@demo.test" });
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
