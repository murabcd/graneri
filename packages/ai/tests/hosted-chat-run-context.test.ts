import { describe, expect, it } from "vitest";
import {
	type AutomationToolInput,
	buildChatAutomationContext,
} from "../src/automation-tools.mjs";
import { prepareHostedAssistantRunInput } from "../src/hosted-assistant-run-input.mjs";
import { buildHostedChatRunContext } from "../src/hosted-chat-run-context.mjs";

describe("hosted chat run context", () => {
	it("loads sources and builds client-executed local folder tools", async () => {
		const latencyStages: string[] = [];
		const automations: unknown[] = [];
		const convexClient = {
			query: async () => null,
			mutation: async () => null,
		};

		const preparedInput = await prepareHostedAssistantRunInput({
			branchFromMessage: async () => undefined,
			chatId: "chat-1",
			contextWindow: {
				compactionLifecycle: {
					start: async () => undefined,
					cancel: async () => undefined,
				},
				loadState: async () => ({
					compaction: {
						summary: "Earlier context.",
						throughCreationTime: 1,
						throughMessageId: "earlier-1",
						updatedAt: 1,
					},
					hasMoreMessages: false,
					messages: [],
				}),
				safetyIdentifier: "owner-1",
				saveCompaction: async () => {
					throw new Error("compaction should not be needed");
				},
			},
			getMessagesSnapshot: async () => [],
			listRunEventsAfter: async () => [],
			message: {
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Use the project" }],
			},
			workspaceId: "workspace-1",
		});
		if (!preparedInput.ok) {
			throw new Error("Expected Assistant Run input preparation to succeed.");
		}
		const context = await preparedInput.complete({
			appsEnabled: false,
			automationActions: {
				createAutomation: async (automation) => {
					automations.push(automation);
					return null;
				},
				deleteAutomation: async () => null,
				getAutomation: async () => null,
				listAutomations: async () => [],
				runAutomationNow: async () => ({ status: "started" }),
				togglePaused: async () => null,
				updateAutomation: async () => null,
			},
			chatAttachmentsApi: {},
			chatId: "chat-1",
			convexClient,
			defaultModel: "gpt-5",
			defaultReasoningEffort: "medium",
			defaultTimezone: "UTC",
			getActiveStreamSession: () => null,
			getNotesContext: async () => "notes",
			getAppConnections: async () => {
				throw new Error(
					"app connections should not load when apps are disabled",
				);
			},
			getSelectedRecipe: async () => ({
				name: "Daily",
				prompt: "Summarize the day.",
			}),
			getStoredNoteContext: async () => "stored note",
			getUserProfileContext: async () => ({ name: "Murad" }),
			localFolders: [{ id: "folder-1", name: "Project", path: "/tmp/project" }],
			logLatency: (stage) => latencyStages.push(stage),
			message: {
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Use the project" }],
			},
			noteId: "note-1",
			selectedSourceIds: ["source-1"],
			workspaceId: "workspace-1",
		});

		expect(context.localFolderRoots).toEqual([
			{ id: "folder-1", name: "Project", path: "/tmp/project" },
		]);
		expect(context.appConnections).toHaveLength(0);
		expect(context.coreToolPolicyState).toEqual({
			chartGenerationRequested: false,
			imageGenerationEnabled: false,
			imageGenerationRequested: false,
			webSearchEnabled: false,
		});
		expect(context.finalizedToolSet.hasTools).toBe(true);
		expect(context.agentTools).not.toHaveProperty("request_user_input");
		expect(context.agentTools?.wait_agent?.execute).toEqual(
			expect.any(Function),
		);
		expect(Object.keys(context.tools)).toEqual(
			expect.arrayContaining([
				"create_automation",
				"delete_automation",
				"get_automation",
				"list_automations",
				"pause_automation",
				"resume_automation",
				"run_automation_now",
				"search_meeting_notes",
				"update_automation",
			]),
		);
		expect(context.instructions).toContain("stored note");
		expect(context.instructions).toContain("Earlier context.");
		expect(context.instructions).toContain("Project");
		expect(automations).toEqual([]);
		expect(latencyStages).toEqual([
			"context.sources_loaded",
			"tools.workspace_ready",
			"tools.finalized",
		]);
	});

	it("builds client-executed tools when local folders belong to the desktop", async () => {
		const context = await buildHostedChatRunContext({
			appsEnabled: false,
			chatAttachmentsApi: {},
			chatId: "chat-1",
			convexClient: { query: async () => null, mutation: async () => null },
			defaultModel: "gpt-5",
			defaultReasoningEffort: "medium",
			defaultTimezone: "UTC",
			getActiveStreamSession: () => null,
			getNotesContext: async () => "",
			getAppConnections: async () => [],
			getSelectedRecipe: async () => null,
			getStoredNoteContext: async () => "",
			getUserProfileContext: async () => null,
			compactionSummary: null,
			localFolders: [{ id: "folder-1", name: "Project", path: "/tmp/project" }],
			logLatency: () => {},
			message: {
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Read the project" }],
			},
			workspaceId: "workspace-1",
		});

		expect(context.localFolderRoots).toEqual([
			{ id: "folder-1", name: "Project", path: "/tmp/project" },
		]);
		expect(context.instructions).toContain("Project");
		expect(context.tools.read_local_file?.execute).toBeUndefined();
	});

	it("keeps every connected app searchable while mentions only add guidance", async () => {
		const context = await buildHostedChatRunContext({
			appsEnabled: true,
			chatAttachmentsApi: {},
			chatId: "chat-1",
			compactionSummary: null,
			convexClient: {
				action: async () => null,
				query: async () => null,
				mutation: async () => null,
			},
			defaultModel: "gpt-5",
			defaultReasoningEffort: "medium",
			defaultTimezone: "UTC",
			getActiveStreamSession: () => null,
			getAppConnections: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
					preview: "Google account",
				},
				{
					id: "app:google-drive",
					provider: "google-drive",
					title: "Google Drive",
					preview: "Google account",
				},
			],
			getNotesContext: async () => "",
			getSelectedRecipe: async () => null,
			getStoredNoteContext: async () => "",
			getUserProfileContext: async () => null,
			logLatency: () => {},
			message: {
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Use Google Calendar" }],
			},
			selectedSourceIds: ["app:google-calendar"],
			workspaceId: "workspace-1",
		});

		expect(context.appConnections).toHaveLength(2);
		expect(context.tools.google_calendar_search_events).toBeDefined();
		expect(context.tools.google_drive_search_files).toBeDefined();
		expect(context.instructions).toContain(
			"selected app source for this chat is Google Calendar",
		);
		expect(context.instructions).not.toContain(
			"selected app source for this chat is Google Drive",
		);
	});
});

describe("chat automation tools", () => {
	const automation = {
		id: "automation-1",
		title: "Daily review",
		prompt: "Review the workspace.",
		model: "gpt-5",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedule: {
			kind: "recurring" as const,
			rrule: "FREQ=DAILY",
			startsAt: "2026-07-20T09:00:00",
			timezone: "UTC",
		},
		target: {
			kind: "workspace",
			label: "Workspace",
		},
		nextRunAt: 86_400_000,
		isPaused: false,
		destination: "current_chat" as const,
		deliveryPolicy: "always" as const,
		stopCondition: null,
		chatId: "chat-1",
	};

	const createAutomationContext = (overrides = {}) =>
		buildChatAutomationContext({
			appConnections: [],
			automationActions: {
				createAutomation: async (input) => ({ ...automation, ...input }),
				deleteAutomation: async () => null,
				getAutomation: async () => automation,
				listAutomations: async () => [automation],
				runAutomationNow: async () => ({
					status: "started",
					chatId: automation.chatId,
				}),
				togglePaused: async () => ({
					...automation,
					isPaused: !automation.isPaused,
				}),
				updateAutomation: async (input) => ({ ...automation, ...input }),
				...overrides,
			},
			chatId: "chat-1",
			defaultModel: "gpt-5",
			defaultReasoningEffort: "medium",
			defaultTimezone: "UTC",
			webSearchEnabled: false,
		});

	it("exposes hosted automation management tools", () => {
		const context = createAutomationContext();

		expect(Object.keys(context.tools).sort()).toEqual([
			"create_automation",
			"delete_automation",
			"get_automation",
			"list_automations",
			"pause_automation",
			"resume_automation",
			"run_automation_now",
			"update_automation",
		]);
		expect(context.instruction).toContain(
			"Broad local windows such as morning, afternoon, or evening are sufficient",
		);
		expect(context.instruction).toContain("failed_runs_only");
	});

	it("creates one-time monitoring automations with an explicit destination", async () => {
		const createInputs: unknown[] = [];
		const context = createAutomationContext({
			createAutomation: async (input: AutomationToolInput) => {
				createInputs.push(input);
				return {
					...automation,
					...input,
				};
			},
		});

		await context.tools.create_automation.execute?.({
			title: "Watch launch",
			prompt: "Check whether the launch is live.",
			schedule: { kind: "once", at: 1_800_000_000_000 },
			destination: "standalone",
			deliveryPolicy: "failed_runs_only",
			stopCondition: "The launch is live.",
		});

		expect(createInputs).toEqual([
			expect.objectContaining({
				destination: "standalone",
				deliveryPolicy: "failed_runs_only",
				stopCondition: "The launch is live.",
				schedule: {
					kind: "once",
					at: 1_800_000_000_000,
					timezone: "UTC",
				},
				chatId: undefined,
			}),
		]);
	});

	it("updates automations while preserving unspecified fields", async () => {
		const updateInputs: unknown[] = [];
		const context = createAutomationContext({
			updateAutomation: async (
				input: AutomationToolInput & { automationId: string },
			) => {
				updateInputs.push(input);
				return {
					...automation,
					...input,
				};
			},
		});

		const result = await context.tools.update_automation.execute?.({
			automationId: "automation-1",
			title: "Updated review",
		});

		expect(updateInputs).toEqual([
			expect.objectContaining({
				automationId: "automation-1",
				title: "Updated review",
				prompt: automation.prompt,
				schedule: automation.schedule,
			}),
		]);
		expect(result).toMatchObject({
			id: automation.id,
			title: "Updated review",
		});
	});

	it("does not toggle pause or resume when already in the requested state", async () => {
		let toggleCount = 0;
		const pausedAutomation = { ...automation, isPaused: true };
		const context = createAutomationContext({
			getAutomation: async () => pausedAutomation,
			togglePaused: async () => {
				toggleCount += 1;
				return { ...pausedAutomation, isPaused: false };
			},
		});

		const pauseResult = await context.tools.pause_automation.execute?.({
			automationId: "automation-1",
		});
		const resumeResult = await context.tools.resume_automation.execute?.({
			automationId: "automation-1",
		});

		expect(toggleCount).toBe(1);
		expect(pauseResult).toMatchObject({ isPaused: true });
		expect(resumeResult).toMatchObject({ isPaused: false });
	});

	it("uses SDK approval before deleting an automation", async () => {
		let deleteCount = 0;
		const context = createAutomationContext({
			deleteAutomation: async () => {
				deleteCount += 1;
				return null;
			},
		});

		await expect(
			context.tools.delete_automation.execute?.({
				automationId: "automation-1",
			}),
		).resolves.toMatchObject({
			id: "automation-1",
			deleted: true,
		});
		expect(deleteCount).toBe(1);
		expect(context.tools.delete_automation.metadata).toMatchObject({
			graneri: {
				authority: {
					access: "write",
					approval: "required",
				},
			},
		});
	});
});
