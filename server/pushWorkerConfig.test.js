import test from "node:test";
import assert from "node:assert/strict";
import { isPushQueueEnabled } from "./pushWorkerConfig.js";

const originalValue = process.env.PUSH_QUEUE_ENABLED;

test.after(() => {
  if (originalValue === undefined) {
    delete process.env.PUSH_QUEUE_ENABLED;
  } else {
    process.env.PUSH_QUEUE_ENABLED = originalValue;
  }
});

test("push worker is disabled when the flag is missing or false", () => {
  delete process.env.PUSH_QUEUE_ENABLED;
  assert.equal(isPushQueueEnabled(), false);

  for (const value of ["", "false", "0", "no", "off", "unexpected"]) {
    process.env.PUSH_QUEUE_ENABLED = value;
    assert.equal(isPushQueueEnabled(), false, value);
  }
});

test("push worker enables only for approved truthy values", () => {
  for (const value of ["true", "TRUE", "1", "yes", "on", " On "]) {
    process.env.PUSH_QUEUE_ENABLED = value;
    assert.equal(isPushQueueEnabled(), true, value);
  }
});
