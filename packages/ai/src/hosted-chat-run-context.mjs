import { buildChatAutomationContext } from "./automation-tools.mjs";
import { CHAT_MODE } from "./chat-mode.mjs";
import { buildCoreChatToolPolicy } from "./chat-tool-policy.mjs";
import { buildConvexWorkspaceToolSet } from "./convex-workspace-tools.mjs";
import { buildHostedChatRunPlan } from "./hosted-chat-run-plan.mjs";
import {
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
} from "./hosted-chat-runtime.mjs";
import { createHostedWaitAgentTool } from "./hosted-chat-wait-agent-tool.mjs";
import { createHostedRunActivityTool } from "./hosted-run-activity.mjs";
import { createHostedUserQuestionTools } from "./hosted-user-question.mjs";
import {
	buildClientLocalFolderTools,
	buildLocalFolderSystemContext,
} from "./local-folder-tools.mjs";

export const buildHostedChatRunContext = async ({
	appsEnabled = false,
	artifactAuthoringApi,
	chatMode = CHAT_MODE.DEFAULT,
	automationActions,
	chatAttachmentsApi,
	chatId,
	compactionSummary,
	convexClient,
	defaultModel,
	defaultReasoningEffort,
	defaultServiceTier,
	defaultTimezone,
	getActiveStreamSession,
	getNotesContext,
	getAppConnections,
	getSelectedRecipe,
	getStoredNoteContext,
	getUserProfileContext,
	localCapabilitySession = null,
	logLatency,
	message,
	noteContext,
	noteId,
	providerOptions,
	publishRunPlan,
	recipeSlug,
	selectedSourceIds = [],
	webSearchEnabled = false,
	workspaceId,
}) => {
	const notesContext = await getNotesContext();
	const attachedNoteContext = noteId
		? await getStoredNoteContext({ noteId, workspaceId })
		: getInlineHostedNoteContext({
				title: noteContext?.title,
				text: noteContext?.text,
			});
	const selectedRecipe = await getSelectedRecipe({ recipeSlug, workspaceId });
	const recipeContext = getHostedChatRecipeContext(selectedRecipe);
	const userProfileContext = await getUserProfileContext();
	const appConnections = appsEnabled
		? await getAppConnections({ workspaceId })
		: [];
	const workspaceToolCatalog = await buildConvexWorkspaceToolSet({
		chatId,
		connections: appConnections,
		convexClient,
		scope: appsEnabled ? "available" : "disabled",
		selectedSourceIds,
		workspaceId,
	});
	const selectedAppConnections = workspaceToolCatalog.selectedConnections;
	const selectedAppSourceInstructions =
		workspaceToolCatalog.selectedSourceInstructions;
	const appTools = workspaceToolCatalog.tools;
	logLatency("context.sources_loaded", {
		appConnectionCount: appConnections.length,
		selectedAppConnectionCount: selectedAppConnections.length,
		hasAttachedNoteContext: attachedNoteContext.length > 0,
		hasNotesContext: notesContext.length > 0,
		hasRecipeContext: recipeContext.length > 0,
		hasUserProfileContext: Boolean(userProfileContext),
	});
	const localFolderRoots = localCapabilitySession
		? [
				{
					id: localCapabilitySession.id,
					name: localCapabilitySession.label,
				},
			]
		: [];
	const localFolderContext = buildLocalFolderSystemContext(localFolderRoots);
	logLatency("tools.workspace_ready", {
		appToolCount: Object.keys(appTools).length,
		localFolderCount: localFolderRoots.length,
	});

	const coreToolPolicy = buildCoreChatToolPolicy({
		artifactAuthoringApi,
		chatAttachmentsApi,
		chatId,
		convexClient,
		message,
		webSearchEnabled,
		workspaceId,
	});
	const automationContext = buildChatAutomationContext({
		appConnections: selectedAppConnections,
		automationActions,
		chatId,
		defaultModel,
		defaultReasoningEffort,
		defaultServiceTier,
		defaultTimezone,
		webSearchEnabled,
	});
	const runPlan = buildHostedChatRunPlan({
		additionalAgentTools: {
			...createHostedUserQuestionTools(chatMode),
			update_plan: createHostedRunActivityTool({
				publishPlan: publishRunPlan,
			}),
			wait_agent: createHostedWaitAgentTool({
				getActiveStreamSession,
			}),
		},
		appTools,
		automationContext,
		context: {
			notesContext,
			attachedNoteContext,
			compactionSummary,
			recipeContext,
			userProfileContext,
		},
		chatMode,
		coreToolPolicy,
		getActiveStreamSession,
		localFolderContext,
		localFolderTools:
			localFolderRoots.length > 0
				? buildClientLocalFolderTools(localFolderRoots)
				: {},
		model: defaultModel,
		providerOptions,
		selectedAppSourceInstructions,
		webSearchEnabled,
	});
	logLatency("tools.finalized", {
		deferredToolCount: runPlan.finalizedToolSet.deferredToolCount,
		hasEnabledTools: runPlan.finalizedToolSet.hasTools,
		hasToolSearch: runPlan.finalizedToolSet.hasToolSearch,
		toolCount: runPlan.finalizedToolSet.toolCount,
	});

	return {
		...runPlan,
		coreToolPolicyState: coreToolPolicy.state,
		localFolderRoots,
		appConnections,
	};
};
