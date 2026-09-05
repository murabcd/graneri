import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	CHAT_PAYLOAD_CHUNK_CHARACTERS,
	type ChatPayloadReference,
	MAX_CHAT_PAYLOAD_BYTES,
	MAX_CHAT_PAYLOAD_CHUNKS,
} from "./chatPayloadModel";

const listChunks = (ctx: QueryCtx | MutationCtx, key: string) =>
	ctx.db
		.query("chatPayloadChunks")
		.withIndex("by_key_and_sequence", (q) => q.eq("key", key))
		.take(MAX_CHAT_PAYLOAD_CHUNKS + 1);

/** Caller owns the parent record and authorizes access before reading. */
const assemblePayload = (
	reference: ChatPayloadReference,
	chunks: Awaited<ReturnType<typeof listChunks>>,
) => {
	if (
		chunks.length !== reference.chunkCount ||
		chunks.some((chunk, sequence) => chunk.sequence !== sequence)
	) {
		throw new ConvexError({
			code: "CHAT_PAYLOAD_INCOMPLETE",
			message: "The saved chat content is incomplete.",
		});
	}
	return chunks.map((chunk) => chunk.content).join("");
};

export const readChatPayload = async (
	ctx: QueryCtx | MutationCtx,
	reference: ChatPayloadReference,
) => assemblePayload(reference, await listChunks(ctx, reference.key));

/** Transform and replace with one chunk read in the owning transaction. */
export const updateChatPayload = async (
	ctx: MutationCtx,
	reference: ChatPayloadReference,
	transform: (content: string) => string | Promise<string>,
) => {
	const existing = await listChunks(ctx, reference.key);
	const next = await transform(assemblePayload(reference, existing));
	return await writeChunks(ctx, reference.key, next, existing);
};

/** Replace the payload atomically with its parent. Unchanged chunks stay put. */
export const writeChatPayload = async (
	ctx: MutationCtx,
	key: string,
	content: string,
): Promise<ChatPayloadReference> =>
	writeChunks(ctx, key, content, await listChunks(ctx, key));

const writeChunks = async (
	ctx: MutationCtx,
	key: string,
	content: string,
	existing: Awaited<ReturnType<typeof listChunks>>,
): Promise<ChatPayloadReference> => {
	const byteLength = new TextEncoder().encode(content).byteLength;
	if (byteLength > MAX_CHAT_PAYLOAD_BYTES) {
		throw new ConvexError({
			code: "CHAT_PAYLOAD_TOO_LARGE",
			message: "Chat content exceeds the 4 MiB payload limit.",
			actualBytes: byteLength,
			maxBytes: MAX_CHAT_PAYLOAD_BYTES,
		});
	}
	let chunkCount = 0;
	for (let start = 0; start < content.length; ) {
		let end = Math.min(start + CHAT_PAYLOAD_CHUNK_CHARACTERS, content.length);
		// Convex strings must be valid Unicode: never cut a surrogate pair.
		const lastCodeUnit = content.charCodeAt(end - 1);
		if (
			end < content.length &&
			lastCodeUnit >= 0xd800 &&
			lastCodeUnit <= 0xdbff
		) {
			end -= 1;
		}
		const chunk = {
			key,
			sequence: chunkCount,
			content: content.slice(start, end),
		};
		const previous = existing[chunkCount];
		if (!previous) {
			await ctx.db.insert("chatPayloadChunks", chunk);
		} else if (
			previous.content !== chunk.content ||
			previous.sequence !== chunk.sequence
		) {
			await ctx.db.replace(previous._id, chunk);
		}
		chunkCount += 1;
		start = end;
	}
	for (const stale of existing.slice(chunkCount))
		await ctx.db.delete(stale._id);
	return { key, chunkCount, byteLength };
};

export const deleteChatPayload = async (
	ctx: MutationCtx,
	reference: ChatPayloadReference,
) => {
	for (const chunk of await listChunks(ctx, reference.key)) {
		await ctx.db.delete(chunk._id);
	}
};
