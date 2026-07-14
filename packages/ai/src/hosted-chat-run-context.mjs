import { buildChatAutomationContext } from "./automation-tools.mjs";
import { buildSelectedAppSourceInstructions } from "./capability-metadata.mjs";
import { buildCoreChatToolPolicy } from "./chat-tool-policy.mjs";
import { buildConvexWorkspaceToolSet } from "./convex-workspace-tools.mjs";
import { buildHostedChatRunPlan } from "./hosted-chat-run-plan.mjs";
import {
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
} from "./hosted-chat-runtime.mjs";
import { createHostedWaitAgentTool } from "./hosted-chat-wait-agent-tool.mjs";
import { MAX_LOCAL_FOLDER_ROOTS } from "./local-folder-tool-definitions.mjs";
import {
	buildClientLocalFolderTools,
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
} from "./local-folder-tools.mjs";

const buildClientLocalFolderRoots = (localFolders) =>
	localFolders
		.slice(0, MAX_LOCAL_FOLDER_ROOTS)
		.map((folder) => {
			const path =
				typeof folder?.path === "string" && folder.path.trim().length > 0
					? folder.path.trim()
					: typeof folder?.name === "string" && folder.name.trim().length > 0
						? folder.name.trim()
						: null;
			if (!path) {
				return null;
			}

			return {
				...(typeof folder.id === "string" && folder.id.length > 0
					? { id: folder.id }
					: {}),
				name:
					typeof folder.name === "string" && folder.name.trim().length > 0
						? folder.name.trim()
						: path,
				path,
			};
		})
		.filter(Boolean);

export const getHostedChatLocalFolderReferencePaths = (localFolders = []) =>
	localFolders.reduce((paths, folder) => {
		if (typeof folder?.path === "string" && folder.path.length > 0) {
			paths.push(folder.path);
		}
		return paths;
	}, []);

export const getHostedChatLocalFolderReferenceIds = (localFolders = []) =>
	localFolders
		.map((folder) => folder?.id)
		.filter((id) => typeof id === "string" && id.length > 0);

export const buildHostedChatRunContext = async ({
	appsEnabled = false,
	automationActions,
	chatAttachmentsApi,
	chatId,
	convexClient,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	getActiveStreamSession,
	getNotesContext,
	getSelectedAppConnections,
	getSelectedRecipe,
	getStoredNoteContext,
	getUserProfileContext,
	localFolders = [],
	localFolderToolMode = "server",
	logLatency,
	message,
	noteContext,
	noteId,
	providerOptions,
	recipeSlug,
	resolveLocalFolderRoots,
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
	const selectedAppConnections = appsEnabled
		? await getSelectedAppConnections({
				selectedSourceIds,
				workspaceId,
			})
		: [];
	const selectedAppSourceInstructions = buildSelectedAppSourceInstructions(
		selectedAppConnections,
	);
	logLatency("context.sources_loaded", {
		appConnectionCount: selectedAppConnections.length,
		hasAttachedNoteContext: attachedNoteContext.length > 0,
		hasNotesContext: notesContext.length > 0,
		hasRecipeContext: recipeContext.length > 0,
		hasUserProfileContext: Boolean(userProfileContext),
	});

	const appTools = await buildConvexWorkspaceToolSet({
		connections: selectedAppConnections,
		convexClient,
		workspaceId,
	});
	const localFolderRoots =
		localFolderToolMode === "client"
			? buildClientLocalFolderRoots(localFolders)
			: await resolveLocalFolderRoots(
					getHostedChatLocalFolderReferencePaths(localFolders),
				);
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
		defaultTimezone,
		webSearchEnabled,
	});
	const runPlan = buildHostedChatRunPlan({
		additionalAgentTools: {
			wait_agent: createHostedWaitAgentTool({
				getActiveStreamSession,
			}),
		},
		appTools,
		automationContext,
		context: {
			notesContext,
			attachedNoteContext,
			recipeContext,
			userProfileContext,
		},
		coreToolPolicy,
		localFolderContext,
		localFolderTools:
			localFolderRoots.length > 0
				? localFolderToolMode === "client"
					? buildClientLocalFolderTools(localFolderRoots)
					: buildLocalFolderTools(localFolderRoots)
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
		selectedAppConnections,
	};
};
