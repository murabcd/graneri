import { createHostedChatTurnInput } from "@workspace/ai/hosted-chat-turn";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { acceptHostedChatTurn } from "../server/chat-accepted-turn-transaction";

type AcceptanceArgs = Parameters<typeof acceptHostedChatTurn>[0];
type AttachableRun = NonNullable<
	AcceptanceArgs["acceptedInput"]["attachableRun"]
>;
type Persistence = AcceptanceArgs["persistence"];

const workspaceId = "workspace-1" as Id<"workspaces">;
const chatId = "chat-1";

const createAttachableRun = (
	runId = "run-existing" as Id<"assistantRuns">,
): AttachableRun => ({
	_id: runId,
	_creationTime: 1,
	ownerTokenIdentifier: "test|owner",
	workspaceId,
	chatId: "stored-chat-1" as Id<"chats">,
	assistantMessageId: "assistant-existing",
	producer: "web",
	status: "running",
	model: "gpt-5.6-sol",
	serviceTier: "auto",
	startedAt: 1,
	updatedAt: 1,
});

const createTurnInput = (attachableRun: AttachableRun | null) =>
	createHostedChatTurnInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>({
		workspaceId,
		chatId,
		attachableRun,
		claimReadyForRun: async () => [],
		discardClaimed: async () => null,
		getClaimedForChat: async () => null,
		interruptActiveRun: async () => [],
		validateInput: () => ({ ok: true }),
	});

const createPersistence = (
	overrides: Partial<Persistence> = {},
): Persistence => ({
	acceptQueuedUserMessage: async () => {},
	acceptSteeredUserMessages: async () => {},
	answerUserQuestion: async () => {},
	completeLocalFolderToolMessage: async () => {},
	persistToolApprovalResponse: async () => {},
	saveMessage: async () => {},
	startBackgroundRun: async () => createAttachableRun(),
	...overrides,
});

const createAcceptanceArgs = ({
	attachableRun = null,
	persistence = createPersistence(),
}: {
	attachableRun?: AttachableRun | null;
	persistence?: Persistence;
}): AcceptanceArgs => {
	const { queuedInput, turnController } = createTurnInput(attachableRun);
	return {
		acceptedInput: {
			attachableRun,
			queuedInput,
			steeredUserMessages: [],
			toolApprovalResponse: null,
			turnController,
			userQuestionAnswer: null,
		},
		cleanupClaimedSteerQueuedMessage: async () => true,
		onSteerAccepted: vi.fn(),
		onUserMessagePersistenceCompleted: vi.fn(),
		persistence,
		policy: {
			admissionReservationId: "admission-1" as Id<"aiAdmissionReservations">,
			appsEnabled: false,
			chatId,
			defaultTimezone: "UTC",
			noteId: null,
			projectId: null,
			selectedSourceIds: [],
			settings: {
				chatMode: "default",
				model: "gpt-5.6-sol",
				reasoningEffort: "medium",
				serviceTier: "auto",
				webSearchEnabled: false,
			},
			workspaceId,
		},
		preparedRun: {
			chatMessages: [],
			coreToolPolicyState: {
				artifactAuthoringEnabled: false,
				artifactAuthoringRequested: false,
				chartGenerationRequested: false,
				imageGenerationEnabled: false,
				imageGenerationRequested: false,
				webSearchEnabled: false,
			},
			instructions: "",
			localFolderRoots: [],
			shouldGenerateChatTitle: false,
		},
	};
};

describe("accepted chat turn transaction", () => {
	it("preserves replay acceptance when the Convex producer cannot start", async () => {
		const mutationNames: string[] = [];
		const persistence = createPersistence({
			acceptQueuedUserMessage: async () => {
				mutationNames.push("chats:acceptQueuedUserMessage");
			},
			startBackgroundRun: async () => {
				mutationNames.push("assistantRunBackground:start");
				throw new Error("producer unavailable");
			},
		});
		const args = createAcceptanceArgs({ persistence });
		args.onUserMessagePersistenceCompleted = () => {
			mutationNames.push("user-message-persistence-completed");
		};
		args.acceptedInput.replayQueuedMessageId =
			"queued-1" as Id<"assistantQueuedMessages">;
		args.preparedRun.lastUserMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Continue" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(mutationNames).toEqual([
			"chats:acceptQueuedUserMessage",
			"user-message-persistence-completed",
			"assistantRunBackground:start",
		]);
		expect(result).toMatchObject({
			ok: false,
			failure: {
				type: "background_run_start",
				pendingQueuedAcceptanceHeaders: expect.any(Object),
			},
		});
	});

	it("checks the same-run invariant before persisting local tool output", async () => {
		const mutation = vi.fn(async () => null);
		const attachableRun = createAttachableRun();
		const args = createAcceptanceArgs({
			attachableRun,
			persistence: createPersistence({
				completeLocalFolderToolMessage: mutation,
			}),
		});
		args.acceptedInput.continueRunId = "run-replaced" as Id<"assistantRuns">;
		args.preparedRun.localFolderRoots = [
			{ id: "folder-1", name: "Workspace", path: "/tmp/workspace" },
		];
		args.preparedRun.localFolderContinuationMessage = {
			id: "assistant-existing",
			role: "assistant",
			parts: [{ type: "text", text: "Local tool result" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(result).toMatchObject({
			ok: false,
			failure: { type: "same_active_run" },
		});
		expect(mutation).not.toHaveBeenCalled();
	});

	it("hands accepted work to exactly one producer", async () => {
		const mutationNames: string[] = [];
		const persistence = createPersistence({
			startBackgroundRun: async () => {
				mutationNames.push("assistantRunBackground:start");
				return createAttachableRun("run-convex" as Id<"assistantRuns">);
			},
		});

		const convexResult = await acceptHostedChatTurn(
			createAcceptanceArgs({ persistence }),
		);
		expect(convexResult).toMatchObject({
			ok: true,
			acceptedTurn: { producer: { type: "convex" } },
		});
		expect(mutationNames).toEqual(["assistantRunBackground:start"]);

		mutationNames.length = 0;
		const webArgs = createAcceptanceArgs({ persistence });
		webArgs.preparedRun.localFolderRoots = [
			{ id: "folder-1", name: "Workspace", path: "/tmp/workspace" },
		];
		const webResult = await acceptHostedChatTurn(webArgs);
		expect(webResult).toMatchObject({
			ok: true,
			acceptedTurn: { producer: { type: "web" } },
		});
		expect(mutationNames).toEqual([]);
	});

	it("resolves a pending question against its exact durable run", async () => {
		const answerUserQuestion = vi.fn(async () => {});
		const attachableRun: AttachableRun = {
			...createAttachableRun(),
			producer: "convex",
			status: "waiting_for_user",
			pendingDecision: {
				type: "user_question",
				assistantMessageId: "assistant-existing",
				toolCallId: "question-1",
				questions: [
					{
						id: "scope",
						question: "Which scope?",
						options: [
							{
								label: "Current note",
								description: "Use only the open note.",
							},
							{
								label: "All notes",
								description: "Search the workspace.",
							},
						],
					},
				],
			},
		};
		const args = createAcceptanceArgs({
			attachableRun,
			persistence: createPersistence({ answerUserQuestion }),
		});
		args.acceptedInput.continueRunId = attachableRun._id;
		args.acceptedInput.userQuestionAnswer = "Current note";

		const result = await acceptHostedChatTurn(args);

		expect(answerUserQuestion).toHaveBeenCalledWith(
			expect.objectContaining({
				answer: "Current note",
				runId: attachableRun._id,
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			acceptedTurn: {
				producer: {
					type: "convex",
					assistantRun: { _id: attachableRun._id },
				},
			},
		});
	});
});
