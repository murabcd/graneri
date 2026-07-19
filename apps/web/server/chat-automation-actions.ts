import type {
	AutomationActions,
	AutomationToolInput,
} from "@workspace/ai/automation-tools";
import {
	type ChatAppSourceProvider,
	chatAppSourceProviders,
} from "@workspace/ai/capability-metadata";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

type AutomationToolTarget = AutomationToolInput["target"];
type AutomationToolUpdateInput = AutomationToolInput & { automationId: string };
const automationMutationAppSourceProviders = new Set<string>(
	chatAppSourceProviders,
);

const toAutomationId = (automationId: string) =>
	automationId as Id<"automations">;

const toNoteId = (noteId: string) => noteId as Id<"notes">;

const toAutomationMutationAppSourceProvider = (
	provider: string,
): ChatAppSourceProvider => {
	if (!automationMutationAppSourceProviders.has(provider)) {
		throw new Error(`Unsupported automation app source: ${provider}`);
	}

	return provider as ChatAppSourceProvider;
};

const toAutomationAppSourceMutationInput = (
	appSources: AutomationToolInput["appSources"],
) =>
	appSources.map((source) => ({
		id: source.id,
		label: source.label,
		provider: toAutomationMutationAppSourceProvider(source.provider),
	}));

const toAutomationTargetMutationInput = (target: AutomationToolTarget) => {
	if (target.kind === "notes") {
		return {
			kind: "notes" as const,
			noteIds: target.noteIds.map(toNoteId),
		};
	}
	return {
		kind: "workspace" as const,
	};
};

const toAutomationCreateMutationInput = (automation: AutomationToolInput) => ({
	...automation,
	appSources: toAutomationAppSourceMutationInput(automation.appSources),
	target: toAutomationTargetMutationInput(automation.target),
});

const toAutomationUpdateMutationInput = (
	automation: AutomationToolUpdateInput,
) => ({
	automationId: toAutomationId(automation.automationId),
	title: automation.title,
	prompt: automation.prompt,
	model: automation.model,
	reasoningEffort: automation.reasoningEffort,
	webSearchEnabled: automation.webSearchEnabled,
	appsEnabled: automation.appsEnabled,
	appSources: toAutomationAppSourceMutationInput(automation.appSources),
	schedule: automation.schedule,
	deliveryPolicy: automation.deliveryPolicy,
	stopCondition: automation.stopCondition,
	target: toAutomationTargetMutationInput(automation.target),
});

export const createHostedChatAutomationActions = ({
	convexClient,
	workspaceId,
}: {
	convexClient: ConvexHttpClient;
	workspaceId: Id<"workspaces">;
}): AutomationActions => ({
	createAutomation: async (automation) =>
		await convexClient.mutation(api.automations.create, {
			workspaceId,
			...toAutomationCreateMutationInput(automation),
		}),
	deleteAutomation: async ({ automationId }) =>
		await convexClient.mutation(api.automations.remove, {
			automationId: toAutomationId(automationId),
		}),
	getAutomation: async ({ automationId }) =>
		await convexClient.query(api.automations.get, {
			automationId: toAutomationId(automationId),
		}),
	listAutomations: async () =>
		await convexClient.query(api.automations.list, { workspaceId }),
	runAutomationNow: async ({ automationId }) =>
		await convexClient.mutation(api.automations.runNow, {
			automationId: toAutomationId(automationId),
		}),
	togglePaused: async ({ automationId }) =>
		await convexClient.mutation(api.automations.togglePaused, {
			automationId: toAutomationId(automationId),
		}),
	updateAutomation: async (automation) =>
		await convexClient.mutation(
			api.automations.update,
			toAutomationUpdateMutationInput(automation),
		),
});
