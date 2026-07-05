import assert from "node:assert/strict";
import test from "node:test";
import { isRecord } from "../src/object-record.mjs";

test("desktop object record guard rejects arrays and primitives", () => {
	const record = { value: 1 };

	assert.equal(isRecord(record), true);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord(["value"]), false);
	assert.equal(isRecord("value"), false);
});
