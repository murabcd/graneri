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
		claimForReplay: async ({ queuedMessageId }) => ({
			status: "claimed",
			claimedMessage: {
				_id: queuedMessageId,
				filesJson: "[]",
				claimVersion: 7,
				messageId: "user-1",
				text: "Continue",
			},
		}),
		claimForSteer: async ({ queuedMessageId }) => ({
			_id: queuedMessageId,
			filesJson: "[]",
			claimVersion: 7,
			messageId: "user-1",
			text: "Continue",
		}),
		releaseClaimed: async () => null,
		validateInput: () => ({ ok: true }),
	});

const createPersistence = (
	overrides: Partial<Persistence> = {},
): Persistence => ({
	acceptQueuedUserMessageAndStartRun: async () =>
		({
			run: createAttachableRun("run-replay" as Id<"assistantRuns">),
		}) as Awaited<
			ReturnType<Persistence["acceptQueuedUserMessageAndStartRun"]>
		>,
	acceptSteeredUserMessage: async () => {},
	answerUserQuestion: async () => {},
	completeLocalFolderToolMessage: async () => {},
	getQueuedMessageAcceptanceStatus: async () => ({
		status: "not_accepted",
	}),
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
			toolApprovalResponse: null,
			turnIntent: { type: "direct", continueRunId: null },
			turnController,
			userQuestionAnswer: null,
		},
		releaseClaimedQueuedMessage: async () => true,
		onSteerAccepted: vi.fn(),
		onUserMessagePersistenceCompleted: vi.fn(),
		persistence,
		policy: {
			admissionReservationId: "admission-1" as Id<"aiAdmissionReservations">,
			appsEnabled: false,
			chatId,
			defaultTimezone: "UTC",
			localCapabilitySession: null,
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
			instructions: "",
			localFolderRoots: [],
			shouldGenerateChatTitle: false,
		},
	};
};

describe("accepted chat turn transaction", () => {
	it("atomically accepts replay input and uses its explicitly returned run", async () => {
		const mutationNames: string[] = [];
		const persistence = createPersistence({
			acceptQueuedUserMessageAndStartRun: async () => {
				mutationNames.push("chats:acceptQueuedUserMessageAndStartRun");
				return {
					run: createAttachableRun("run-replay" as Id<"assistantRuns">),
				} as Awaited<
					ReturnType<Persistence["acceptQueuedUserMessageAndStartRun"]>
				>;
			},
			startBackgroundRun: async () => {
				mutationNames.push("assistantRunBackground:start");
				return createAttachableRun();
			},
		});
		const args = createAcceptanceArgs({ persistence });
		args.onUserMessagePersistenceCompleted = () => {
			mutationNames.push("user-message-persistence-completed");
		};
		const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;
		args.acceptedInput.turnIntent = {
			type: "replay",
			expectedStatus: "queued",
			queuedMessageId,
		};
		await args.acceptedInput.queuedInput.claimReplay({
			expectedStatus: "queued",
			queuedMessageId,
		});
		args.preparedRun.lastUserMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Continue" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(mutationNames).toEqual([
			"chats:acceptQueuedUserMessageAndStartRun",
			"user-message-persistence-completed",
		]);
		expect(result).toMatchObject({
			ok: true,
			acceptedTurn: {
				pendingQueuedAcceptanceHeaders: expect.any(Object),
				producer: {
					type: "convex",
					assistantRun: {
						_id: "run-replay",
						assistantMessageId: "assistant-existing",
					},
				},
			},
		});
	});

	it("releases server-claimed input when persistence fails before acceptance", async () => {
		const persistError = new Error("persistence unavailable");
		const releaseClaimedQueuedMessage = vi.fn(async () => true);
		const args = createAcceptanceArgs({
			persistence: createPersistence({
				acceptQueuedUserMessageAndStartRun: async () => {
					throw persistError;
				},
			}),
		});
		args.releaseClaimedQueuedMessage = releaseClaimedQueuedMessage;
		const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;
		args.acceptedInput.turnIntent = {
			type: "replay",
			expectedStatus: "queued",
			queuedMessageId,
		};
		await args.acceptedInput.queuedInput.claimReplay({
			expectedStatus: "queued",
			queuedMessageId,
		});
		args.preparedRun.lastUserMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Retry me" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(releaseClaimedQueuedMessage).toHaveBeenCalledOnce();
		expect(result).toEqual({
			ok: false,
			failure: {
				error: persistError,
				isQueuedAccept: true,
				type: "user_message_persist",
			},
		});
	});

	it("recovers a committed replay when the mutation response is lost", async () => {
		const releaseClaimedQueuedMessage = vi.fn(async () => true);
		let attemptedReplay:
			| Parameters<Persistence["acceptQueuedUserMessageAndStartRun"]>[0]
			| null = null;
		const args = createAcceptanceArgs({
			persistence: createPersistence({
				acceptQueuedUserMessageAndStartRun: async (input) => {
					attemptedReplay = input;
					throw new Error("mutation response lost");
				},
				getQueuedMessageAcceptanceStatus: async () => {
					if (!attemptedReplay) {
						throw new Error("Replay acceptance was not attempted.");
					}
					return {
						status: "accepted" as const,
						receipt: {
							kind: "replay" as const,
							producer: attemptedReplay.run.producer,
							queuedMessageId: "queued-1" as Id<"assistantQueuedMessages">,
							claimVersion: 7,
							messageId: "user-1",
							runId: "run-recovered" as Id<"assistantRuns">,
							assistantMessageId: attemptedReplay.run.assistantMessageId,
						},
					};
				},
			}),
		});
		args.releaseClaimedQueuedMessage = releaseClaimedQueuedMessage;
		const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;
		args.acceptedInput.turnIntent = {
			type: "replay",
			expectedStatus: "queued",
			queuedMessageId,
		};
		await args.acceptedInput.queuedInput.claimReplay({
			expectedStatus: "queued",
			queuedMessageId,
		});
		args.preparedRun.lastUserMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Continue" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(releaseClaimedQueuedMessage).not.toHaveBeenCalled();
		expect(attemptedReplay).not.toBeNull();
		expect(result).toMatchObject({
			ok: true,
			acceptedTurn: {
				assistantMessageId: attemptedReplay?.run.assistantMessageId,
				pendingQueuedAcceptanceHeaders: expect.any(Object),
				producer: {
					type: "convex",
					assistantRun: {
						_id: "run-recovered",
						assistantMessageId: attemptedReplay?.run.assistantMessageId,
					},
				},
			},
		});
	});

	it("recovers a committed steer when the mutation response is lost", async () => {
		const attachableRun = createAttachableRun();
		const releaseClaimedQueuedMessage = vi.fn(async () => true);
		const onSteerAccepted = vi.fn();
		let attemptedSteer:
			| Parameters<Persistence["acceptSteeredUserMessage"]>[0]
			| null = null;
		const args = createAcceptanceArgs({
			attachableRun,
			persistence: createPersistence({
				acceptSteeredUserMessage: async (input) => {
					attemptedSteer = input;
					throw new Error("mutation response lost");
				},
				getQueuedMessageAcceptanceStatus: async () => {
					if (!attemptedSteer) {
						throw new Error("Steer acceptance was not attempted.");
					}
					return {
						status: "accepted" as const,
						receipt: {
							kind: "steer" as const,
							producer: attachableRun.producer,
							queuedMessageId: "queued-1" as Id<"assistantQueuedMessages">,
							claimVersion: 7,
							messageId: "user-1",
							runId: attachableRun._id,
							assistantMessageId: attachableRun.assistantMessageId,
						},
					};
				},
			}),
		});
		args.releaseClaimedQueuedMessage = releaseClaimedQueuedMessage;
		args.onSteerAccepted = onSteerAccepted;
		const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;
		args.acceptedInput.turnIntent = {
			type: "steer",
			runId: attachableRun._id,
			queuedMessageId,
		};
		await args.acceptedInput.queuedInput.claimSteer({
			runId: attachableRun._id,
			queuedMessageId,
		});
		args.preparedRun.lastUserMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Continue" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(releaseClaimedQueuedMessage).not.toHaveBeenCalled();
		expect(onSteerAccepted).toHaveBeenCalledWith(attachableRun._id);
		expect(attemptedSteer).toMatchObject({
			assistantMessageId: attachableRun.assistantMessageId,
		});
		expect(result).toMatchObject({
			ok: true,
			acceptedTurn: {
				assistantMessageId: attachableRun.assistantMessageId,
				pendingQueuedAcceptanceHeaders: expect.any(Object),
				producer: { type: "web", assistantRun: null },
			},
		});
	});

	it.each([
		{
			name: "assistant generation",
			receipt: { assistantMessageId: "another-generation", producer: "convex" },
		},
		{
			name: "producer",
			receipt: { assistantMessageId: null, producer: "web" },
		},
	])("fails closed when a replay receipt changes $name", async ({
		receipt,
	}) => {
		const releaseClaimedQueuedMessage = vi.fn(async () => true);
		let attemptedAssistantMessageId: string | null = null;
		const args = createAcceptanceArgs({
			persistence: createPersistence({
				acceptQueuedUserMessageAndStartRun: async (input) => {
					attemptedAssistantMessageId = input.run.assistantMessageId;
					throw new Error("mutation response lost");
				},
				getQueuedMessageAcceptanceStatus: async () => ({
					status: "accepted",
					receipt: {
						kind: "replay",
						producer: receipt.producer,
						queuedMessageId: "queued-1" as Id<"assistantQueuedMessages">,
						claimVersion: 7,
						messageId: "user-1",
						runId: "run-recovered" as Id<"assistantRuns">,
						assistantMessageId:
							receipt.assistantMessageId ?? attemptedAssistantMessageId ?? "",
					},
				}),
			}),
		});
		args.releaseClaimedQueuedMessage = releaseClaimedQueuedMessage;
		const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;
		args.acceptedInput.turnIntent = {
			type: "replay",
			expectedStatus: "queued",
			queuedMessageId,
		};
		await args.acceptedInput.queuedInput.claimReplay({
			expectedStatus: "queued",
			queuedMessageId,
		});
		args.preparedRun.lastUserMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Continue" }],
		};

		const result = await acceptHostedChatTurn(args);

		expect(result).toMatchObject({
			ok: false,
			failure: { type: "queued_acceptance_status_lookup" },
		});
		expect(releaseClaimedQueuedMessage).not.toHaveBeenCalled();
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
		args.acceptedInput.turnIntent = {
			type: "direct",
			continueRunId: "run-replaced" as Id<"assistantRuns">,
		};
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
		args.acceptedInput.turnIntent = {
			type: "direct",
			continueRunId: attachableRun._id,
		};
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
