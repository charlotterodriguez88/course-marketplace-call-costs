import assert from "node:assert/strict";
import test from "node:test";

import { readCallReceipt } from "../src/call_receipt.ts";

test("reads the cost and vendor for one course-listing call", () => {
  const headers = new Headers({
    "x-infrai-cost-usd": "0.0042",
    "x-infrai-vendor": "example-vendor",
  });

  assert.deepEqual(readCallReceipt(headers, "listing-lesson-7"), {
    requestId: "listing-lesson-7",
    costUsd: 0.0042,
    vendor: "example-vendor",
  });
});
