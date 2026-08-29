import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

test("branching distinguishes an old target from a missing target", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-oversized-branch",
		preview: "Oldest prompt",
		message: {
			id: "message-0",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Oldest prompt" }]),
			text: "Oldest prompt",
			createdAt: 1_000,
		},
	});

	await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", "chat-oversized-branch"),
			)
			.unique();
		if (!chat) {
			throw new Error("Expected chat to exist.");
		}

		for (let index = 1; index <= 201; index += 1) {
			await ctx.db.insert("chatMessages", {
				chatId: chat._id,
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				messageId: `message-${index}`,
				role: index % 2 === 0 ? "user" : "assistant",
				partsJson: JSON.stringify([{ type: "text", text: `Message ${index}` }]),
				text: `Message ${index}`,
				createdAt: 1_000 + index,
			});
		}
	});

	await expect(
		asOwner.mutation(api.chatBranches.branchFromMessage, {
			workspaceId,
			chatId: "chat-oversized-branch",
			messageId: "message-0",
		}),
	).rejects.toThrow("Chat branch target is too far back to replace.");

	await expect(
		asOwner.mutation(api.chatBranches.branchFromMessage, {
			workspaceId,
			chatId: "chat-oversized-branch",
			messageId: "missing-message",
		}),
	).rejects.toThrow("Chat branch target is no longer available.");

	const state = await t.run(async (ctx) => {
		const branches = await ctx.db.query("chatBranches").collect();
		const messages = await ctx.db.query("chatMessages").collect();
		return { branchCount: branches.length, messageCount: messages.length };
	});
	expect(state).toEqual({ branchCount: 0, messageCount: 202 });
});
