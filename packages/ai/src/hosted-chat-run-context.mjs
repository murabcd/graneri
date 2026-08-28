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
import { MAX_LOCAL_FOLDER_ROOTS } from "./local-folder-tool-definitions.mjs";
import {
	buildClientLocalFolderTools,
	buildLocalFolderSystemContext,
} from "./local-folder-tools.mjs";

const buildClientLocalFolderRoots = (localFolders) => {
	if (localFolders.length > MAX_LOCAL_FOLDER_ROOTS) {
		throw new Error(
			`At most ${MAX_LOCAL_FOLDER_ROOTS} local folders can be shared with one chat.`,
		);
	}

	return localFolders.map((folder) => {
		if (
			typeof folder?.id !== "string" ||
			!folder.id.trim() ||
			typeof folder.name !== "string" ||
			!folder.name.trim() ||
			typeof folder.path !== "string" ||
			!folder.path.trim()
		) {
			throw new Error("Shared local folder metadata is invalid.");
		}

		return {
			id: folder.id.trim(),
			name: folder.name.trim(),
			path: folder.path.trim(),
		};
	});
};

export const buildHostedChatRunContext = async ({
	appsEnabled = false,
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
	localFolders = [],
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
	const localFolderRoots = buildClientLocalFolderRoots(localFolders);
	const localFolderContext = buildLocalFolderSystemContext(localFolderRoots);
	logLatency("tools.workspace_ready", {
		appToolCount: Object.keys(appTools).length,
		localFolderCount: localFolderRoots.length,
	});

	const coreToolPolicy = buildCoreChatToolPolicy({
		chatAttachmentsApi,
		convexClient,
		message,
		webSearchEnabled,
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
