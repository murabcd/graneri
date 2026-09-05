import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	readChatContent,
	requireChatContent,
	writeChatContent,
} from "./chatContentStorage";
import { MAX_CHAT_PAYLOAD_BYTES } from "./chatPayloadModel";

const messageContentSchema = z.object({
	partsJson: z.string(),
	text: z.string(),
});
export type ChatMessageContent = z.infer<typeof messageContentSchema>;

export type HydratedChatMessage = Omit<
	Doc<"chatMessages">,
	"contentId" | "preview"
> &
	ChatMessageContent;

/** Select a contiguous prefix before reading chunks, leaving room for runtime state. */
export const selectChatMessageBatch = async (
	ctx: QueryCtx | MutationCtx,
	messages: Doc<"chatMessages">[],
) => {
	let bytes = 0;
	const selected: Doc<"chatMessages">[] = [];
	for (const message of messages) {
		const content = await requireChatContent(ctx, message.contentId);
		if (bytes + content.payload.byteLength > MAX_CHAT_PAYLOAD_BYTES) break;
		bytes += content.payload.byteLength;
		selected.push(message);
	}
	return selected;
};

export const hydrateChatMessage = async <
	T extends {
		contentId: Id<"chatContents">;
		preview?: string;
		hasContent?: boolean;
	},
>(
	ctx: QueryCtx | MutationCtx,
	record: T,
) => {
	const {
		contentId,
		preview: _preview,
		hasContent: _hasContent,
		...metadata
	} = record;
	const body = messageContentSchema.parse(
		JSON.parse(await readChatContent(ctx, contentId)),
	);
	return { ...metadata, ...body };
};

export const writeChatMessageContent = (
	ctx: MutationCtx,
	body: ChatMessageContent,
	previousId?: Id<"chatContents">,
) => writeChatContent(ctx, JSON.stringify(body), previousId);
