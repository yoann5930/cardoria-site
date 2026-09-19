import test from "node:test";
import assert from "node:assert/strict";
import { liveCaptureReplayState } from "../lib/marketplace/paypal.js";

test("paid and completed live checkouts are idempotently already paid", () => {
  for (const status of ["paid", "completed"]) {
    const checkout = { id: "LCK-PAID", status };
    assert.deepEqual(liveCaptureReplayState(checkout), {
      provider: "paypal",
      alreadyPaid: true,
      checkout
    });
  }
});

test("refunded live checkouts are protected and never reported already paid", () => {
  for (const status of ["refunded", "refund_reconciliation_required"]) {
    const checkout = { id: "LCK-REFUND", status };
    assert.deepEqual(liveCaptureReplayState(checkout), {
      provider: "paypal",
      alreadyPaid: false,
      protected: true,
      checkout
    });
  }
});

test("pending live checkout proceeds to real capture path", () => {
  assert.equal(liveCaptureReplayState({ id: "LCK-PENDING", status: "pending" }), null);
});
