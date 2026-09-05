import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
	CHAT_PAYLOAD_CHUNK_CHARACTERS,
	MAX_CHAT_PAYLOAD_BYTES,
} from "./chatPayloadModel";
import {
	deleteChatPayload,
	readChatPayload,
	writeChatPayload,
} from "./chatPayloads";
import schema from "./schema";
import { modules } from "./test.setup";

test("payloads larger than one document round-trip Unicode without oversized chunks", async () => {
	const t = convexTest(schema, modules);
	const content = `${"x".repeat(CHAT_PAYLOAD_CHUNK_CHARACTERS - 1)}${"🌳日本語".repeat(120_000)}`;
	const reference = await t.run((ctx) =>
		writeChatPayload(ctx, "unicode", content),
	);
	expect(reference.byteLength).toBeGreaterThan(1_048_576);
	expect(await t.run((ctx) => readChatPayload(ctx, reference))).toBe(content);
	const chunks = await t.run((ctx) =>
		ctx.db.query("chatPayloadChunks").collect(),
	);
	for (const chunk of chunks) {
		expect(getDocumentSize(chunk)).toBeLessThan(1_048_576);
		expect(
			new TextDecoder().decode(new TextEncoder().encode(chunk.content)),
		).toBe(chunk.content);
	}
});

test("append keeps the existing prefix and shrink and deletion leave no stale chunks", async () => {
	const t = convexTest(schema, modules);
	const prefix = "a".repeat(CHAT_PAYLOAD_CHUNK_CHARACTERS * 2);
	await t.run((ctx) => writeChatPayload(ctx, "mutable", prefix));
	const original = await t.run((ctx) =>
		ctx.db.query("chatPayloadChunks").collect(),
	);
	await t.run((ctx) => writeChatPayload(ctx, "mutable", `${prefix}tail`));
	const appended = await t.run((ctx) =>
		ctx.db.query("chatPayloadChunks").collect(),
	);
	expect(appended.slice(0, 2)).toEqual(original);
	const short = await t.run((ctx) => writeChatPayload(ctx, "mutable", "short"));
	expect(await t.run((ctx) => readChatPayload(ctx, short))).toBe("short");
	expect(
		await t.run((ctx) => ctx.db.query("chatPayloadChunks").collect()),
	).toHaveLength(1);
	await t.run((ctx) => deleteChatPayload(ctx, short));
	expect(
		await t.run((ctx) => ctx.db.query("chatPayloadChunks").collect()),
	).toEqual([]);
});

test("rejects missing chunks instead of returning a truncated saved message", async () => {
	const t = convexTest(schema, modules);
	const reference = await t.run((ctx) =>
		writeChatPayload(ctx, "incomplete", "saved"),
	);
	await t.run(async (ctx) => {
		const chunk = await ctx.db.query("chatPayloadChunks").first();
		if (!chunk) throw new Error("Missing fixture chunk");
		await ctx.db.delete(chunk._id);
	});
	await expect(t.run((ctx) => readChatPayload(ctx, reference))).rejects.toThrow(
		"incomplete",
	);
});

test("an oversized replacement fails before modifying the saved payload", async () => {
	const t = convexTest(schema, modules);
	const reference = await t.run((ctx) =>
		writeChatPayload(ctx, "limited", "saved"),
	);
	await expect(
		t.run((ctx) =>
			writeChatPayload(ctx, "limited", "x".repeat(MAX_CHAT_PAYLOAD_BYTES + 1)),
		),
	).rejects.toThrow("4 MiB");
	expect(await t.run((ctx) => readChatPayload(ctx, reference))).toBe("saved");
});
