import { isRateLimitError } from "@convex-dev/rate-limiter";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	rateLimiterTest.register(t);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	return { t, workspaceId };
};

test("connected app tool proxies require authentication", async () => {
	const { t, workspaceId } = await createWorkspace();

	await expect(
		t.action(api.connectedAppTools.listRemoteMcpTools, {
			workspaceId,
			sourceId: "app:connection-id",
		}),
	).rejects.toThrow("signed in");
});

test("connected app tool proxies reject unbounded inputs before execution", async () => {
	const { t, workspaceId } = await createWorkspace();
	const asOwner = t.withIdentity(ownerIdentity);

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "proxy-test",
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		message: {
			id: "user-1",
			role: "user",
			partsJson: '[{"type":"text","text":"Prompt"}]',
			text: "Prompt",
			createdAt: 1,
		},
	});
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "proxy-test",
		assistantMessageId: "assistant",
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});

	await expect(
		asOwner.action(api.connectedAppTools.executeRemoteMcpTool, {
			workspaceId,
			sourceId: "app:connection-id",
			toolName: "search",
			inputJson: "x".repeat(1_000_001),
			runId: run._id,
			assistantMessageId: "assistant",
		}),
	).rejects.toThrow("tool input is invalid");
});

test("connected app tool proxies rate-limit bursts per owner", async () => {
	const { t } = await createWorkspace();

	for (let request = 0; request < 30; request += 1) {
		await t.mutation(internal.connectedAppRateLimits.consumeToolRequest, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		});
	}

	const error = await t
		.mutation(internal.connectedAppRateLimits.consumeToolRequest, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		})
		.catch((caught) => caught);

	expect(isRateLimitError(error)).toBe(true);
});
