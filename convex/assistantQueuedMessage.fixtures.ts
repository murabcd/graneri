import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

export const createQueuedRequestBody = (
	overrides: Partial<DurableQueuedChatRequest> = {},
): DurableQueuedChatRequest => ({
	...DEFAULT_CHAT_SETTINGS,
	localCapabilitySession: null,
	timezone: "UTC",
	...overrides,
	projectId: overrides.projectId ?? null,
});

export const createQueuedRequestBodyJson = (
	overrides?: Partial<DurableQueuedChatRequest>,
) => JSON.stringify(createQueuedRequestBody(overrides));

export const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

export const createWorkspace = async () => {
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

	return {
		asOwner,
		t,
		workspaceId,
	};
};

type WorkspaceFixture = Awaited<ReturnType<typeof createWorkspace>>;
type AsOwner = WorkspaceFixture["asOwner"];
type WorkspaceId = WorkspaceFixture["workspaceId"];

export const createChat = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) => {
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		preview: "Prompt",
		message: {
			id: `${chatId}-user-1`,
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
};

export const startRun = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) =>
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: `${chatId}-assistant-1`,
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});

export const queuedMessageInput = (messageId: string, text: string) => ({
	messageId,
	text,
	requestBodyJson: createQueuedRequestBodyJson(),
});
export type QueuedMessageInput = ReturnType<typeof queuedMessageInput> & {
	metadataJson?: string;
};

export const insertDuplicateActiveRun = async ({
	run,
	t,
	workspaceId,
}: {
	run: Awaited<ReturnType<typeof startRun>>;
	t: Awaited<ReturnType<typeof createWorkspace>>["t"];
	workspaceId: WorkspaceId;
}) => {
	await t.run(async (ctx) => {
		await ctx.db.insert("assistantRuns", {
			localCapabilitySession: null,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			assistantMessageId: `${run.assistantMessageId}-duplicate`,
			producer: "web",
			status: "running",
			model: "gpt-5",
			serviceTier: "auto",
			startedAt: 3_000,
			updatedAt: 3_000,
		});
	});
};
