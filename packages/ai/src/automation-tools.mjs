import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { automationAppSourceProviders } from "./capability-metadata.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const AUTOMATION_TOOL_NAMESPACE = Object.freeze({
	name: "automations",
	description:
		"Create scheduled work and manage existing Graneri automations only when the user asks for automatic, recurring, or later execution.",
});

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
	serviceTier: automation.serviceTier,
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

const toAutomationAdapterTarget = (target, toNoteId) =>
	target.kind === "notes"
		? {
				kind: "notes",
				noteIds: target.noteIds.map(toNoteId),
			}
		: {
				kind: "workspace",
			};

const toAutomationAdapterAppSources = (appSources) =>
	appSources.map((source) => automationAppSourceSchema.parse(source));

const toAutomationCreateMutationInput = (
	{ chatId: _sourceChatId, ...automation },
	toNoteId,
) => ({
	...automation,
	appSources: toAutomationAdapterAppSources(automation.appSources),
	target: toAutomationAdapterTarget(automation.target, toNoteId),
});

const toAutomationUpdateMutationInput = (
	{ automationId, ...automation },
	toAutomationId,
	toNoteId,
) => ({
	automationId: toAutomationId(automationId),
	title: automation.title,
	prompt: automation.prompt,
	model: automation.model,
	reasoningEffort: automation.reasoningEffort,
	serviceTier: automation.serviceTier,
	webSearchEnabled: automation.webSearchEnabled,
	appsEnabled: automation.appsEnabled,
	appSources: toAutomationAdapterAppSources(automation.appSources),
	schedule: automation.schedule,
	deliveryPolicy: automation.deliveryPolicy,
	stopCondition: automation.stopCondition,
	target: toAutomationAdapterTarget(automation.target, toNoteId),
});

export const createAutomationMutationInputNormalizer = ({
	toAutomationId,
	toNoteId,
}) => ({
	automationId: toAutomationId,
	create: (automation) => toAutomationCreateMutationInput(automation, toNoteId),
	update: (automation) =>
		toAutomationUpdateMutationInput(automation, toAutomationId, toNoteId),
});

export const createAutomationTool = ({
	appSources,
	chatId,
	createAutomation,
	defaultModel,
	defaultReasoningEffort,
	defaultServiceTier,
	defaultTimezone,
	webSearchEnabled,
}) =>
	defineAiTool({
		name: "create_automation",
		description: [
			"Create a one-time or recurring Graneri automation only when the user asks for work to happen automatically, later, on a schedule, or as ongoing monitoring. Do not use this for work requested in the current response.",
			`Current time: ${new Date().toISOString()}. User timezone: ${defaultTimezone}.`,
			"For a one-time task, use an exact epoch-millisecond instant. For recurring work, use a local startsAt value, an IANA timezone, and an RFC 5545 RRULE without DTSTART; runs cannot be more frequent than hourly. A broad window such as morning may be resolved to a reasonable visible local time, but ask when the date, timezone, recurrence, or time window remains ambiguous.",
			"Use meaningful_change for monitoring that should stay quiet without a material change, failed_runs_only when only failures should notify, and copy any requested end condition into stopCondition. Keep the title short and the prompt self-contained without the scheduling phrase.",
		].join(" "),
		inputSchema: z.object({
			title: z
				.string()
				.min(1)
				.max(80)
				.describe("Short, specific automation title."),
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
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "required",
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
				serviceTier: defaultServiceTier,
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
		name: "list_automations",
		description:
			"List the user's automations in the current workspace. Use this before updating, pausing, resuming, running, or deleting when the target automation is ambiguous.",
		inputSchema: z.object({}),
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "read",
			approval: "not_required",
			capability: "read",
			provider: "graneri",
		},
		ui: toolUiMetadata.list_automations,
		execute: async () => toAutomationListToolResult(await listAutomations()),
	}).toAITool();

const createGetAutomationTool = ({ getAutomation }) =>
	defineAiTool({
		name: "get_automation",
		description:
			"Get the full configuration and state of one existing Graneri automation by id. Use this when the user asks for its details or before editing it; list automations first when the id is unknown.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "read",
			approval: "not_required",
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
		name: "update_automation",
		description:
			"Update the title, task prompt, schedule, delivery policy, stop condition, or app sources of an existing Graneri automation. Use only when the user asks to change an automation; omitted fields keep their current values. List or get the automation first when its id or current configuration is unknown.",
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
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "required",
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
				serviceTier: currentAutomation.serviceTier,
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
		name: "pause_automation",
		description:
			"Pause an existing active Graneri automation so future scheduled runs stop until it is resumed. Use only when the user asks to pause or temporarily disable it; list automations first when its id is unknown.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "required",
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
		name: "resume_automation",
		description:
			"Resume a paused Graneri automation so its scheduled runs continue. Use only when the user asks to resume or reactivate it; list automations first when its id is unknown.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "required",
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
		name: "run_automation_now",
		description:
			"Start one immediate manual run of an existing Graneri automation without changing its schedule. Use only when the user explicitly asks to run that automation now; list automations first when its id is unknown.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "required",
			capability: "write",
			provider: "graneri",
		},
		ui: toolUiMetadata.run_automation_now,
		execute: async ({ automationId }) =>
			await runAutomationNow({ automationId }),
	}).toAITool();

const createDeleteAutomationTool = ({ deleteAutomation }) =>
	defineAiTool({
		name: "delete_automation",
		description:
			"Permanently delete an existing Graneri automation by id. Use only when the current user message explicitly asks to delete, remove, or permanently disable that automation; use pause_automation for temporary disabling. List automations first when its id is unknown.",
		inputSchema: z.object({
			automationId: automationIdSchema,
		}),
		namespace: AUTOMATION_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "required",
			capability: "write",
			provider: "graneri",
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
	defaultServiceTier,
	defaultTimezone,
	webSearchEnabled,
}) => {
	if (!chatId || !automationActions?.createAutomation) {
		return {
			tools: {},
		};
	}

	const appSources = normalizeAutomationAppSources(appConnections);

	return {
		tools: {
			create_automation: createAutomationTool({
				appSources,
				chatId,
				createAutomation: automationActions.createAutomation,
				defaultModel,
				defaultReasoningEffort,
				defaultServiceTier,
				defaultTimezone,
				webSearchEnabled,
			}),
			...(automationActions.listAutomations && {
				list_automations: createListAutomationsTool({
					listAutomations: automationActions.listAutomations,
				}),
			}),
			...(automationActions.getAutomation && {
				get_automation: createGetAutomationTool({
					getAutomation: automationActions.getAutomation,
				}),
			}),
			...(automationActions.getAutomation &&
				automationActions.updateAutomation && {
					update_automation: createUpdateAutomationTool({
						appSources,
						defaultTimezone,
						getAutomation: automationActions.getAutomation,
						updateAutomation: automationActions.updateAutomation,
					}),
				}),
			...(automationActions.getAutomation &&
				automationActions.togglePaused && {
					pause_automation: createPauseAutomationTool({
						getAutomation: automationActions.getAutomation,
						togglePaused: automationActions.togglePaused,
					}),
					resume_automation: createResumeAutomationTool({
						getAutomation: automationActions.getAutomation,
						togglePaused: automationActions.togglePaused,
					}),
				}),
			...(automationActions.runAutomationNow && {
				run_automation_now: createRunAutomationNowTool({
					runAutomationNow: automationActions.runAutomationNow,
				}),
			}),
			...(automationActions.deleteAutomation && {
				delete_automation: createDeleteAutomationTool({
					deleteAutomation: automationActions.deleteAutomation,
				}),
			}),
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
