import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { automationAppSourceProviders } from "./capability-metadata.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const automationScheduleSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("once"),
		at: z
			.number()
			.finite()
			.describe("The exact one-time run instant as Unix epoch milliseconds."),
		timezone: z
			.string()
			.min(1)
			.optional()
			.describe("IANA timezone. Omit to use the user's current timezone."),
	}),
	z.object({
		kind: z.literal("recurring"),
		rrule: z
			.string()
			.min(1)
			.max(512)
			.describe(
				"RFC 5545 RRULE without DTSTART, for example FREQ=WEEKLY;BYDAY=MO,WE,FR. Do not schedule more often than hourly.",
			),
		startsAt: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/)
			.describe(
				"Local start date and time in YYYY-MM-DDTHH:mm:ss form, without a timezone offset.",
			),
		timezone: z
			.string()
			.min(1)
			.optional()
			.describe("IANA timezone. Omit to use the user's current timezone."),
	}),
]);

const automationAppSourceSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	provider: z.enum(automationAppSourceProviders),
});

const automationIdSchema = z.string().min(1);

const getAvailableAppSourceDescription = (appSources) => {
	if (appSources.length === 0) {
		return "No connected app source ids are available in this chat. Omit appSourceIds.";
	}

	return `Available connected app source ids: ${appSources
		.map((source) => `${source.id} (${source.label})`)
		.join(", ")}. Only use ids from this list.`;
};

const validateSelectedAppSources = ({ appSourceIds, appSources }) => {
	if (!appSourceIds || appSourceIds.length === 0) {
		return null;
	}

	const validAppSourceIds = new Set(appSources.map((source) => source.id));
	const unknownAppSourceIds = appSourceIds.filter(
		(sourceId) => !validAppSourceIds.has(sourceId),
	);

	if (unknownAppSourceIds.length > 0) {
		throw new Error(
			`Unknown automation app source id${unknownAppSourceIds.length === 1 ? "" : "s"}: ${unknownAppSourceIds.join(", ")}`,
		);
	}

	return appSources.filter((source) => appSourceIds.includes(source.id));
};

const toAutomationToolResult = (automation) => ({
	id: automation.id,
	title: automation.title,
	prompt: automation.prompt,
	model: automation.model,
	reasoningEffort: automation.reasoningEffort,
	webSearchEnabled: automation.webSearchEnabled,
	appsEnabled: automation.appsEnabled,
	appSources: automation.appSources,
	schedule: automation.schedule,
	target: automation.target,
	destination: automation.destination,
	deliveryPolicy: automation.deliveryPolicy,
	stopCondition: automation.stopCondition,
	nextRunAt: automation.nextRunAt,
	isPaused: automation.isPaused,
	chatId: automation.chatId,
});

const toAutomationListToolResult = (automations) =>
	automations.map(toAutomationToolResult);

const toAutomationMutationTarget = (target) =>
	target?.kind === "notes"
		? {
				kind: "notes",
				noteIds: target.noteIds ?? [],
			}
		: {
				kind: "workspace",
			};

export const buildAutomationCreationInstruction = ({ now, timezone }) =>
	[
		"When the user asks to create, schedule, run, watch, check, summarize, remind, or report on something automatically once or on a recurring cadence, use the create_automation tool.",
		"When the user asks to list, inspect, edit, update, pause, resume, run now, or delete existing automations, use the matching automation management tool.",
		"Do not merely explain how to manage automations when the user's wording is an instruction to do it.",
		"Only delete an automation when the current user message explicitly asks to delete, remove, or disable it permanently. The delete_automation tool first asks for confirmation; call it with confirmed true only after the user confirms deletion.",
		`Current time for scheduling: ${new Date(now).toISOString()}. User timezone: ${timezone}.`,
		"For a one-time task, provide an exact epoch-millisecond instant. For recurring work, provide a local startsAt value, an IANA timezone, and an RFC 5545 RRULE without DTSTART. Broad local windows such as morning, afternoon, or evening are sufficient: choose a reasonable local start time and make it visible in the created schedule. Ask one focused clarification question only when the intended date, timezone, recurrence, or time window is still ambiguous.",
		"Automations cannot run more often than once per hour.",
		"For monitoring requests, use meaningful_change delivery so routine checks stay quiet, and include a stop condition when the user says when monitoring should end.",
		"Use failed_runs_only delivery when the user asks to be notified only when the scheduled task fails.",
		"Use the user's requested task as the automation prompt, omitting the scheduling phrase. Keep titles short and specific.",
	].join("\n");

export const createAutomationTool = ({
	appSources,
	chatId,
	createAutomation,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	webSearchEnabled,
}) =>
	defineAiTool({
		deferLoading: false,
		name: "create_automation",
		description:
			"Create a one-time or recurring Graneri automation from the current chat. Use this when the user asks for a task to run automatically on a schedule.",
		inputSchema: z.object({
			title: z.string().min(1).max(80),
			prompt: z
				.string()
				.min(1)
				.describe(
					"The task to run each time, without the scheduling phrase. Include enough context for future runs.",
				),
			schedule: automationScheduleSchema,
			destination: z
				.enum(["current_chat", "standalone"])
				.default("current_chat")
				.describe(
					"Use current_chat when the user wants this conversation to remain the task context. Use standalone for an independent task and result thread.",
				),
			deliveryPolicy: z
				.enum(["always", "failed_runs_only", "meaningful_change"])
				.default("always")
				.describe(
					"Use failed_runs_only to notify only on failures. Use meaningful_change for monitoring tasks that should notify only when the observed state materially changes.",
				),
			stopCondition: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Optional condition that ends future runs once the result proves it is met.",
				),
			appSourceIds: z
				.array(z.string().min(1))
				.optional()
				.describe(
					`Optional selected connected app source ids to attach to the automation. Omit to use the chat's selected app sources. ${getAvailableAppSourceDescription(appSources)}`,
				),
		}),
		policy: {
			access: "write",
			capability: "create",
			provider: "graneri",
		},
		ui: toolUiMetadata.create_automation,
		execute: async ({
			appSourceIds,
			deliveryPolicy,
			destination,
			prompt,
			schedule,
			stopCondition,
			title,
		}) => {
			const selectedAppSources =
				validateSelectedAppSources({ appSourceIds, appSources }) ?? appSources;
			const automation = await createAutomation({
				title,
				prompt,
				model: defaultModel,
				reasoningEffort: defaultReasoningEffort,
				webSearchEnabled,
				appsEnabled: selectedAppSources.length > 0,
				appSources: selectedAppSources,
				schedule: {
					...schedule,
					timezone: schedule.timezone ?? defaultTimezone,
				},
				target: {
					kind: "workspace",
				},
				destination,
				deliveryPolicy,
				stopCondition,
				chatId: destination === "current_chat" ? chatId : undefined,
			});

			return toAutomationToolResult(automation);
		},
	}).toAITool();

const createListAutomationsTool = ({ listAutomations }) =>
	defineAiTool({
		deferLoading: false,
		name: "list_automations",
		description:
			"List the user's automations in the current workspace. Use this before updating, pausing, resuming, running, or deleting when the target automation is ambiguous.",
		inputSchema: z.object({}),
		policy: {
			access: "read",
			capability: "read",
			provider: "graneri",
		},
		ui: toolUiMetadata.list_automations,
		execute: async () => toAutomationListToolResult(await listAutomations()),
	}).toAITool();

const createGetAutomationTool = ({ getAutomation }) =>
	defineAiTool({
		deferLoading: false,
		name: "get_automation",
		description:
			"Get one automation by id before editing it or when the user asks for its details.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "read",
			capability: "read",
			provider: "graneri",
		},
		ui: toolUiMetadata.get_automation,
		execute: async ({ automationId }) => {
			const automation = await getAutomation({ automationId });
			if (!automation) {
				throw new Error("Automation not found.");
			}

			return toAutomationToolResult(automation);
		},
	}).toAITool();

const createUpdateAutomationTool = ({
	appSources,
	defaultTimezone,
	getAutomation,
	updateAutomation,
}) =>
	defineAiTool({
		deferLoading: false,
		name: "update_automation",
		description:
			"Update an existing Graneri automation. Omitted fields keep their current values.",
		inputSchema: z.object({
			automationId: automationIdSchema,
			title: z.string().min(1).max(80).optional(),
			prompt: z.string().min(1).optional(),
			schedule: automationScheduleSchema.optional(),
			deliveryPolicy: z
				.enum(["always", "failed_runs_only", "meaningful_change"])
				.optional(),
			stopCondition: z.string().min(1).nullable().optional(),
			appSourceIds: z
				.array(z.string().min(1))
				.optional()
				.describe(
					`Optional replacement connected app source ids. Omit to keep current app sources. ${getAvailableAppSourceDescription(appSources)}`,
				),
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.update_automation,
		execute: async ({
			appSourceIds,
			automationId,
			deliveryPolicy,
			prompt,
			schedule,
			stopCondition,
			title,
		}) => {
			const currentAutomation = await getAutomation({ automationId });
			if (!currentAutomation) {
				throw new Error("Automation not found.");
			}

			const selectedAppSources =
				validateSelectedAppSources({ appSourceIds, appSources }) ??
				currentAutomation.appSources;
			const automation = await updateAutomation({
				automationId,
				title: title ?? currentAutomation.title,
				prompt: prompt ?? currentAutomation.prompt,
				model: currentAutomation.model,
				reasoningEffort: currentAutomation.reasoningEffort,
				webSearchEnabled: currentAutomation.webSearchEnabled,
				appsEnabled: selectedAppSources.length > 0,
				appSources: selectedAppSources,
				schedule: schedule
					? {
							...schedule,
							timezone: schedule.timezone ?? defaultTimezone,
						}
					: currentAutomation.schedule,
				destination: currentAutomation.destination,
				deliveryPolicy: deliveryPolicy ?? currentAutomation.deliveryPolicy,
				stopCondition:
					stopCondition === undefined
						? (currentAutomation.stopCondition ?? undefined)
						: (stopCondition ?? undefined),
				target: toAutomationMutationTarget(currentAutomation.target),
				chatId: currentAutomation.chatId,
			});

			return toAutomationToolResult(automation);
		},
	}).toAITool();

const createPauseAutomationTool = ({ getAutomation, togglePaused }) =>
	defineAiTool({
		deferLoading: false,
		name: "pause_automation",
		description: "Pause an active automation by id.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.pause_automation,
		execute: async ({ automationId }) => {
			const currentAutomation = await getAutomation({ automationId });
			if (!currentAutomation) {
				throw new Error("Automation not found.");
			}
			if (currentAutomation.isPaused) {
				return toAutomationToolResult(currentAutomation);
			}

			return toAutomationToolResult(await togglePaused({ automationId }));
		},
	}).toAITool();

const createResumeAutomationTool = ({ getAutomation, togglePaused }) =>
	defineAiTool({
		deferLoading: false,
		name: "resume_automation",
		description: "Resume a paused automation by id.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.resume_automation,
		execute: async ({ automationId }) => {
			const currentAutomation = await getAutomation({ automationId });
			if (!currentAutomation) {
				throw new Error("Automation not found.");
			}
			if (!currentAutomation.isPaused) {
				return toAutomationToolResult(currentAutomation);
			}

			return toAutomationToolResult(await togglePaused({ automationId }));
		},
	}).toAITool();

const createRunAutomationNowTool = ({ runAutomationNow }) =>
	defineAiTool({
		deferLoading: false,
		name: "run_automation_now",
		description: "Start an automation manual run now by id.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.run_automation_now,
		execute: async ({ automationId }) =>
			await runAutomationNow({ automationId }),
	}).toAITool();

const createDeleteAutomationTool = ({ deleteAutomation }) =>
	defineAiTool({
		deferLoading: false,
		name: "delete_automation",
		description:
			"Delete an automation by id. Only use when the current user message explicitly asks to delete, remove, or permanently disable that automation.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		policy: {
			access: "write",
			capability: "write",
			provider: "graneri",
			requiresApproval: true,
		},
		ui: toolUiMetadata.delete_automation,
		execute: async ({ automationId }) => {
			await deleteAutomation({ automationId });

			return {
				id: automationId,
				deleted: true,
			};
		},
	}).toAITool();

export const buildChatAutomationContext = ({
	appConnections,
	automationActions,
	chatId,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	webSearchEnabled,
}) => {
	if (!chatId || !automationActions?.createAutomation) {
		return {
			instruction: "",
			tools: {},
		};
	}

	const appSources = normalizeAutomationAppSources(appConnections);

	return {
		instruction: buildAutomationCreationInstruction({
			now: Date.now(),
			timezone: defaultTimezone,
		}),
		tools: {
			create_automation: createAutomationTool({
				appSources,
				chatId,
				createAutomation: automationActions.createAutomation,
				defaultModel,
				defaultReasoningEffort,
				defaultTimezone,
				webSearchEnabled,
			}),
			...(automationActions.listAutomations
				? {
						list_automations: createListAutomationsTool({
							listAutomations: automationActions.listAutomations,
						}),
					}
				: {}),
			...(automationActions.getAutomation
				? {
						get_automation: createGetAutomationTool({
							getAutomation: automationActions.getAutomation,
						}),
					}
				: {}),
			...(automationActions.getAutomation && automationActions.updateAutomation
				? {
						update_automation: createUpdateAutomationTool({
							appSources,
							defaultTimezone,
							getAutomation: automationActions.getAutomation,
							updateAutomation: automationActions.updateAutomation,
						}),
					}
				: {}),
			...(automationActions.getAutomation && automationActions.togglePaused
				? {
						pause_automation: createPauseAutomationTool({
							getAutomation: automationActions.getAutomation,
							togglePaused: automationActions.togglePaused,
						}),
						resume_automation: createResumeAutomationTool({
							getAutomation: automationActions.getAutomation,
							togglePaused: automationActions.togglePaused,
						}),
					}
				: {}),
			...(automationActions.runAutomationNow
				? {
						run_automation_now: createRunAutomationNowTool({
							runAutomationNow: automationActions.runAutomationNow,
						}),
					}
				: {}),
			...(automationActions.deleteAutomation
				? {
						delete_automation: createDeleteAutomationTool({
							deleteAutomation: automationActions.deleteAutomation,
						}),
					}
				: {}),
		},
	};
};

export const normalizeAutomationAppSources = (connections) =>
	connections
		.map((connection) => {
			const id = connection.sourceId ?? connection.id;
			const label =
				connection.displayName ?? connection.title ?? connection.provider ?? "";
			const provider = connection.provider;

			if (!id || !label || !provider) {
				return null;
			}

			const parsed = automationAppSourceSchema.safeParse({
				id,
				label,
				provider,
			});

			return parsed.success ? parsed.data : null;
		})
		.filter(Boolean);
