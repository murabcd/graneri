import {
	getDesktopAuthCallbackUrl,
	openDesktopExternalUrl,
} from "@workspace/platform/desktop";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { writeTextToClipboard } from "@/components/note/share-note";
import { getErrorMessageWithoutTrailingPeriod as getToastErrorMessage } from "@/components/settings/connection-error-message";
import {
	connectionsSettingsReducer,
	getStableConnectionSettingsKey,
	initialConnectionsSettingsState,
	initialContext7ConnectionFormState,
	initialFigmaConnectionFormState,
	initialJiraConnectionFormState,
	initialJiraMcpConnectionFormState,
	initialLinearConnectionFormState,
	initialNotionConnectionFormState,
	initialPostHogConnectionFormState,
	initialYandexTrackerConnectionFormState,
	initialZoomConnectionFormState,
	resolveConnectionSettings,
	stableConnectionSettingsStore,
	type YandexTrackerOrgType,
} from "@/components/settings/connection-settings-state";
import { useRemoteMcpConnectionSession } from "@/components/settings/use-remote-mcp-connection-session";
import { useYandexCalendarConnectionSession } from "@/components/settings/use-yandex-calendar-connection-session";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { authClient } from "@/lib/auth-client";
import {
	GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_SCOPES,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	GOOGLE_DRIVE_SCOPE,
	GOOGLE_DRIVE_SCOPES,
	getGoogleLinkedAccount,
	hasGoogleScope,
} from "@/lib/google-integrations";
import { logError } from "@/lib/logger";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const getConnectedAppQueryArgs = (workspaceId: Id<"workspaces"> | null) =>
	workspaceId ? { workspaceId } : ("skip" as const);

export function useConnectedAppSettingsSession() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const { data: session } = authClient.useSession();
	const { accounts, loadAccounts } = useLinkedAccounts(session?.user);
	const stableConnectionSettingsKey = getStableConnectionSettingsKey({
		workspaceId: activeWorkspaceId,
		email: session?.user?.email,
	});
	const yandexTrackerConnectionResult = useQuery(
		api.appConnections.getYandexTracker,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const yandexCalendarConnectionResult = useQuery(
		api.appConnections.getYandexCalendar,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const calendarPreferences = useQuery(
		api.calendarPreferences.get,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const updateCalendarPreferences = useMutation(api.calendarPreferences.update);
	const jiraConnectionResult = useQuery(
		api.appConnections.getJira,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const jiraMcpConnectionResult = useQuery(
		api.appConnections.getJiraMcp,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const posthogConnectionResult = useQuery(
		api.appConnections.getPostHog,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const context7ConnectionResult = useQuery(
		api.appConnections.getContext7,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const figmaConnectionResult = useQuery(
		api.appConnections.getFigma,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const linearConnectionResult = useQuery(
		api.appConnections.getLinear,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const notionConnectionResult = useQuery(
		api.appConnections.getNotion,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const zoomConnectionResult = useQuery(
		api.appConnections.getZoom,
		getConnectedAppQueryArgs(activeWorkspaceId),
	);
	const connectionQueryResults = useMemo(
		() => ({
			yandexTracker: yandexTrackerConnectionResult,
			yandexCalendar: yandexCalendarConnectionResult,
			jira: jiraConnectionResult,
			jiraMcp: jiraMcpConnectionResult,
			posthog: posthogConnectionResult,
			context7: context7ConnectionResult,
			figma: figmaConnectionResult,
			linear: linearConnectionResult,
			notion: notionConnectionResult,
			zoom: zoomConnectionResult,
		}),
		[
			context7ConnectionResult,
			figmaConnectionResult,
			jiraConnectionResult,
			jiraMcpConnectionResult,
			linearConnectionResult,
			notionConnectionResult,
			posthogConnectionResult,
			yandexCalendarConnectionResult,
			yandexTrackerConnectionResult,
			zoomConnectionResult,
		],
	);
	const stableConnectionSettings = resolveConnectionSettings({
		cachedSettings: stableConnectionSettingsKey
			? stableConnectionSettingsStore.get(stableConnectionSettingsKey)
			: undefined,
		results: connectionQueryResults,
	});
	const yandexTrackerConnection = stableConnectionSettings.yandexTracker;
	const yandexCalendarConnection = stableConnectionSettings.yandexCalendar;
	const jiraConnection = stableConnectionSettings.jira;
	const jiraMcpConnection = stableConnectionSettings.jiraMcp;
	const posthogConnection = stableConnectionSettings.posthog;
	const context7Connection = stableConnectionSettings.context7;
	const figmaConnection = stableConnectionSettings.figma;
	const linearConnection = stableConnectionSettings.linear;
	const notionConnection = stableConnectionSettings.notion;
	const zoomConnection = stableConnectionSettings.zoom;
	const connectYandexTracker = useAction(
		api.appConnectionActions.connectYandexTracker,
	);
	const connectJira = useAction(api.appConnectionActions.connectJira);
	const connectJiraMcp = useAction(api.appConnectionActions.connectJiraMcp);
	const connectContext7 = useAction(api.appConnectionActions.connectContext7);
	const connectFigma = useAction(api.appConnectionActions.connectFigma);
	const connectLinear = useAction(api.appConnectionActions.connectLinear);
	const connectPostHog = useAction(api.appConnectionActions.connectPostHog);
	const connectNotion = useAction(api.appConnectionActions.connectNotion);
	const connectZoom = useAction(api.appConnectionActions.connectZoom);
	const disableConnection = useMutation(api.appConnections.disableConnection);
	const prepareJiraMentionSync = useAction(
		api.appConnectionActions.prepareJiraMentionSync,
	);
	const [state, dispatch] = useReducer(
		connectionsSettingsReducer,
		initialConnectionsSettingsState,
	);
	const [convexSiteUrl, setConvexSiteUrl] = useState<string | null>(null);
	const [isConnectingGoogleCalendarTool, setIsConnectingGoogleCalendarTool] =
		useState(false);
	const [isConnectingGoogleDriveTool, setIsConnectingGoogleDriveTool] =
		useState(false);
	const [isPreparingJiraMentionSync, setIsPreparingJiraMentionSync] =
		useState(false);
	const lastPreparedJiraSyncKeyRef = useRef<string | null>(null);
	const {
		isYandexTrackerDialogOpen,
		isJiraDialogOpen,
		isSavingYandexTrackerConnection,
		isSavingJiraConnection,
		isDisablingConnection,
		yandexTrackerFormState,
		jiraFormState,
	} = state;
	const googleAccount = getGoogleLinkedAccount(accounts);
	const hasGoogleCalendarToolScope =
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_SCOPE) &&
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_WRITE_SCOPE) &&
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_MANAGE_SCOPE) &&
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_LIST_MANAGE_SCOPE);
	const hasGoogleDriveToolScope = hasGoogleScope(
		googleAccount,
		GOOGLE_DRIVE_SCOPE,
	);
	const googleCalendarEnabledForWorkspace =
		calendarPreferences?.showGoogleCalendar ?? false;
	const googleDriveEnabledForWorkspace =
		calendarPreferences?.showGoogleDrive ?? false;
	const yandexCalendarDialog = useYandexCalendarConnectionSession({
		activeWorkspaceId,
		defaultEmail: session?.user?.email,
		yandexCalendarConnection,
	});

	useEffect(() => {
		if (!stableConnectionSettingsKey) {
			return;
		}

		stableConnectionSettingsStore.update(
			stableConnectionSettingsKey,
			connectionQueryResults,
		);
	}, [connectionQueryResults, stableConnectionSettingsKey]);

	useEffect(() => {
		let isMounted = true;

		void loadRuntimeConfig()
			.then((config) => {
				if (isMounted) {
					setConvexSiteUrl(config.convexSiteUrl);
				}
			})
			.catch(() => {});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		const jiraConnection = stableConnectionSettings.jira;
		if (!activeWorkspaceId || !jiraConnection) {
			lastPreparedJiraSyncKeyRef.current = null;
			return;
		}

		if (jiraConnection.webhookSecret && jiraConnection.accountId) {
			return;
		}

		const syncKey = `${activeWorkspaceId}:${jiraConnection.sourceId}`;

		if (lastPreparedJiraSyncKeyRef.current === syncKey) {
			return;
		}

		lastPreparedJiraSyncKeyRef.current = syncKey;
		setIsPreparingJiraMentionSync(true);

		void prepareJiraMentionSync({ workspaceId: activeWorkspaceId })
			.catch((error) => {
				lastPreparedJiraSyncKeyRef.current = null;
				toast.error(
					getToastErrorMessage(error, "Failed to prepare Jira mention sync"),
				);
			})
			.finally(() => {
				setIsPreparingJiraMentionSync(false);
			});
	}, [
		activeWorkspaceId,
		prepareJiraMentionSync,
		stableConnectionSettings.jira,
	]);

	const handleYandexTrackerDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsYandexTrackerDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setYandexTrackerFormState",
				value: {
					orgType: yandexTrackerConnection?.orgType ?? "x-org-id",
					orgId: yandexTrackerConnection?.orgId ?? "",
					token: "",
				},
			});
		} else {
			dispatch({
				type: "setYandexTrackerFormState",
				value: initialYandexTrackerConnectionFormState,
			});
		}
	};

	const handleConnectYandexTracker = async () => {
		if (
			!activeWorkspaceId ||
			!yandexTrackerFormState.orgId.trim() ||
			!yandexTrackerFormState.token.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingYandexTrackerConnection", value: true });

		try {
			await connectYandexTracker({
				workspaceId: activeWorkspaceId,
				orgType: yandexTrackerFormState.orgType,
				orgId: yandexTrackerFormState.orgId.trim(),
				token: yandexTrackerFormState.token.trim(),
			});
			toast.success("Yandex Tracker connected");
			handleYandexTrackerDialogOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Yandex Tracker",
			});
			toast.error(
				getToastErrorMessage(error, "Failed to connect Yandex Tracker"),
			);
		} finally {
			dispatch({ type: "setIsSavingYandexTrackerConnection", value: false });
		}
	};

	const isYandexTrackerFormValid =
		yandexTrackerFormState.orgId.trim().length > 0 &&
		yandexTrackerFormState.token.trim().length > 0;

	const handleJiraDialogOpenChange = (open: boolean) => {
		dispatch({ type: "setIsJiraDialogOpen", value: open });

		if (open) {
			dispatch({
				type: "setJiraFormState",
				value: {
					baseUrl: jiraConnection?.baseUrl ?? "",
					email: jiraConnection?.email ?? session?.user?.email ?? "",
					token: "",
				},
			});
		} else {
			dispatch({
				type: "setJiraFormState",
				value: initialJiraConnectionFormState,
			});
		}
	};

	const handleConnectJira = async () => {
		if (
			!activeWorkspaceId ||
			!jiraFormState.baseUrl.trim() ||
			!jiraFormState.email.trim() ||
			!jiraFormState.token.trim()
		) {
			return;
		}

		dispatch({ type: "setIsSavingJiraConnection", value: true });

		try {
			await connectJira({
				workspaceId: activeWorkspaceId,
				baseUrl: jiraFormState.baseUrl.trim(),
				email: jiraFormState.email.trim(),
				token: jiraFormState.token.trim(),
			});
			toast.success("Jira Sync connected");
			handleJiraDialogOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Jira",
			});
			toast.error(getToastErrorMessage(error, "Failed to connect Jira"));
		} finally {
			dispatch({ type: "setIsSavingJiraConnection", value: false });
		}
	};

	const isJiraFormValid =
		jiraFormState.baseUrl.trim().length > 0 &&
		jiraFormState.email.trim().length > 0 &&
		jiraFormState.token.trim().length > 0;

	const jiraMcpSession = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: jiraMcpConnection,
		defaultFormState: initialJiraMcpConnectionFormState,
		defaultDisplayName: "Jira",
		requireEnvValue: true,
		connect: connectJiraMcp,
		connectionLabel: "Jira",
		connectedMessage: "Continue in Jira to finish connecting",
		requiresOAuth: true,
	});
	const context7Session = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: context7Connection,
		defaultFormState: initialContext7ConnectionFormState,
		defaultDisplayName: "Context7",
		requireEnvValue: true,
		connect: connectContext7,
		connectionLabel: "Context7",
		connectedMessage: "Context7 connected",
		requiresOAuth: false,
	});
	const figmaSession = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: figmaConnection,
		defaultFormState: initialFigmaConnectionFormState,
		defaultDisplayName: "Figma",
		requireEnvValue: false,
		connect: connectFigma,
		connectionLabel: "Figma",
		connectedMessage: "Continue in Figma to finish connecting",
		requiresOAuth: true,
	});
	const linearSession = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: linearConnection,
		defaultFormState: initialLinearConnectionFormState,
		defaultDisplayName: "Linear",
		requireEnvValue: false,
		connect: connectLinear,
		connectionLabel: "Linear",
		connectedMessage: "Continue in Linear to finish connecting",
		requiresOAuth: true,
	});
	const posthogSession = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: posthogConnection,
		defaultFormState: initialPostHogConnectionFormState,
		defaultDisplayName: "PostHog",
		requireEnvValue: true,
		connect: connectPostHog,
		connectionLabel: "PostHog",
		connectedMessage: "Continue in PostHog to finish connecting",
		requiresOAuth: true,
	});
	const notionSession = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: notionConnection,
		defaultFormState: initialNotionConnectionFormState,
		defaultDisplayName: "Notion",
		requireEnvValue: false,
		connect: connectNotion,
		connectionLabel: "Notion",
		connectedMessage: "Continue in Notion to finish connecting",
		requiresOAuth: true,
	});
	const zoomSession = useRemoteMcpConnectionSession({
		workspaceId: activeWorkspaceId,
		connection: zoomConnection,
		defaultFormState: initialZoomConnectionFormState,
		defaultDisplayName: "Zoom",
		requireEnvValue: false,
		connect: connectZoom,
		connectionLabel: "Zoom",
		connectedMessage: "Continue in Zoom to finish connecting",
		requiresOAuth: true,
	});

	const disableAppConnection = async ({
		sourceId,
		successMessage,
		onDisabled,
	}: {
		sourceId: string;
		successMessage: string;
		onDisabled: () => void;
	}) => {
		if (!activeWorkspaceId || isDisablingConnection) {
			return;
		}

		dispatch({ type: "setIsDisablingConnection", value: true });

		try {
			await disableConnection({
				workspaceId: activeWorkspaceId,
				sourceId,
			});
			toast.success(successMessage);
			onDisabled();
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to disable connection",
			});
			toast.error(getToastErrorMessage(error, "Failed to disable connection"));
		} finally {
			dispatch({ type: "setIsDisablingConnection", value: false });
		}
	};

	const handleDisableJiraSync = async () => {
		if (!jiraConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: jiraConnection.sourceId,
			successMessage: "Jira Sync disabled",
			onDisabled: () => handleJiraDialogOpenChange(false),
		});
	};

	const handleDisableJiraMcp = async () => {
		if (!jiraMcpConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: jiraMcpConnection.sourceId,
			successMessage: "Jira disabled",
			onDisabled: () => jiraMcpSession.handleOpenChange(false),
		});
	};

	const handleDisableYandexCalendar = async () => {
		if (!yandexCalendarConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: yandexCalendarConnection.sourceId,
			successMessage: "Yandex Calendar disabled",
			onDisabled: () =>
				yandexCalendarDialog.handleYandexCalendarDialogOpenChange(false),
		});
	};

	const handleDisableYandexTracker = async () => {
		if (!yandexTrackerConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: yandexTrackerConnection.sourceId,
			successMessage: "Yandex Tracker disabled",
			onDisabled: () => handleYandexTrackerDialogOpenChange(false),
		});
	};

	const handleDisablePostHog = async () => {
		if (!posthogConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: posthogConnection.sourceId,
			successMessage: "PostHog disabled",
			onDisabled: () => posthogSession.handleOpenChange(false),
		});
	};

	const handleDisableContext7 = async () => {
		if (!context7Connection) {
			return;
		}

		await disableAppConnection({
			sourceId: context7Connection.sourceId,
			successMessage: "Context7 disabled",
			onDisabled: () => context7Session.handleOpenChange(false),
		});
	};

	const handleDisableFigma = async () => {
		if (!figmaConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: figmaConnection.sourceId,
			successMessage: "Figma disabled",
			onDisabled: () => figmaSession.handleOpenChange(false),
		});
	};

	const handleDisableLinear = async () => {
		if (!linearConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: linearConnection.sourceId,
			successMessage: "Linear disabled",
			onDisabled: () => linearSession.handleOpenChange(false),
		});
	};

	const handleDisableNotion = async () => {
		if (!notionConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: notionConnection.sourceId,
			successMessage: "Notion disabled",
			onDisabled: () => notionSession.handleOpenChange(false),
		});
	};

	const handleDisableZoom = async () => {
		if (!zoomConnection) {
			return;
		}

		await disableAppConnection({
			sourceId: zoomConnection.sourceId,
			successMessage: "Zoom disabled",
			onDisabled: () => zoomSession.handleOpenChange(false),
		});
	};

	const connectGoogleTool = async ({
		enableForWorkspace,
		scopes,
		onStateChange,
		successMessage,
	}: {
		enableForWorkspace: "calendar" | "drive";
		scopes: readonly string[];
		onStateChange: (value: boolean) => void;
		successMessage: string;
	}) => {
		onStateChange(true);

		try {
			const enableGoogleToolForWorkspace = async () => {
				if (!activeWorkspaceId) {
					return;
				}

				await updateCalendarPreferences({
					workspaceId: activeWorkspaceId,
					showGoogleCalendar:
						enableForWorkspace === "calendar"
							? true
							: googleCalendarEnabledForWorkspace,
					showGoogleDrive:
						enableForWorkspace === "drive"
							? true
							: googleDriveEnabledForWorkspace,
					showYandexCalendar: calendarPreferences?.showYandexCalendar ?? false,
				});
			};
			const callbackURL = await getDesktopAuthCallbackUrl(window.location.href);
			const result = await authClient.$fetch("/link-social", {
				method: "POST",
				throw: true,
				body: {
					provider: "google",
					callbackURL,
					errorCallbackURL: callbackURL,
					disableRedirect: true,
					scopes: [...scopes],
				},
			});
			const resultObject = result && typeof result === "object" ? result : null;
			const url =
				resultObject && "url" in resultObject
					? String(resultObject.url ?? "")
					: "";
			const linkedWithoutRedirect =
				resultObject !== null &&
				"status" in resultObject &&
				Boolean(resultObject.status) &&
				"redirect" in resultObject &&
				resultObject.redirect === false;

			if (!url) {
				if (linkedWithoutRedirect) {
					await enableGoogleToolForWorkspace();
					await loadAccounts();
					toast.success(successMessage);
					return;
				}

				throw new Error("Google auth URL was not returned.");
			}

			// Tool capability must be enabled before handing the user to the browser auth flow.
			await enableGoogleToolForWorkspace();

			if (await openDesktopExternalUrl(url)) {
				return;
			}

			window.location.assign(url);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Google tool",
			});
			toast.error(
				getToastErrorMessage(error, "Failed to connect Google account"),
			);
		} finally {
			onStateChange(false);
		}
	};
	const handleConfigureGoogleCalendar = () => {
		void connectGoogleTool({
			enableForWorkspace: "calendar",
			scopes: GOOGLE_CALENDAR_SCOPES,
			onStateChange: setIsConnectingGoogleCalendarTool,
			successMessage: "Google Calendar connected",
		});
	};
	const handleConfigureGoogleDrive = () => {
		void connectGoogleTool({
			enableForWorkspace: "drive",
			scopes: GOOGLE_DRIVE_SCOPES,
			onStateChange: setIsConnectingGoogleDriveTool,
			successMessage: "Google Drive connected",
		});
	};

	const jiraWebhookUrl =
		convexSiteUrl && jiraConnection?.webhookSecret
			? (() => {
					const url = new URL("/api/webhooks/jira", convexSiteUrl);
					url.searchParams.set("sourceId", jiraConnection.sourceId);
					url.searchParams.set("secret", jiraConnection.webhookSecret);
					return url.toString();
				})()
			: null;

	const handleCopyJiraWebhookUrl = async () => {
		if (!jiraWebhookUrl) {
			toast.error("Jira webhook URL is not ready yet");
			return;
		}

		try {
			await writeTextToClipboard(jiraWebhookUrl);
			toast.success("Jira webhook URL copied");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to copy Jira webhook URL",
			});
			toast.error("Failed to copy Jira webhook URL");
		}
	};

	const handleOpenJiraWebhookSettings = async () => {
		if (!jiraConnection?.baseUrl) {
			return;
		}

		const url = new URL(
			"/plugins/servlet/webhooks",
			jiraConnection.baseUrl,
		).toString();

		if (await openDesktopExternalUrl(url)) {
			return;
		}

		window.open(url, "_blank", "noopener,noreferrer");
	};

	return {
		activeWorkspaceId,
		googleCalendarInstalled:
			hasGoogleCalendarToolScope && googleCalendarEnabledForWorkspace,
		googleDriveInstalled:
			hasGoogleDriveToolScope && googleDriveEnabledForWorkspace,
		hasAuthenticatedUser: Boolean(session?.user),
		...yandexCalendarDialog,
		handleConnectJira,
		handleCopyJiraWebhookUrl,
		handleConnectYandexTracker,
		handleConfigureGoogleCalendar,
		handleConfigureGoogleDrive,
		handleDisableJiraMcp,
		handleDisableContext7,
		handleDisableFigma,
		handleDisableLinear,
		handleDisableJiraSync,
		handleDisableNotion,
		handleDisablePostHog,
		handleDisableYandexCalendar,
		handleDisableYandexTracker,
		handleDisableZoom,
		handleJiraDialogOpenChange,
		handleOpenJiraWebhookSettings,
		handleYandexTrackerDialogOpenChange,
		isJiraDialogOpen,
		isJiraFormValid,
		isDisablingConnection,
		isConnectingGoogleCalendarTool,
		isConnectingGoogleDriveTool,
		isPreparingJiraMentionSync,
		isSavingJiraConnection,
		isSavingYandexTrackerConnection,
		isYandexTrackerDialogOpen,
		isYandexTrackerFormValid,
		jiraConnection,
		jiraFormState,
		jiraWebhookUrl,
		remoteMcp: {
			context7: context7Session,
			figma: figmaSession,
			jira: jiraMcpSession,
			linear: linearSession,
			notion: notionSession,
			posthog: posthogSession,
			zoom: zoomSession,
		},
		yandexCalendarConnection,
		yandexTrackerConnection,
		setJiraBaseUrl: (baseUrl: string) =>
			dispatch({
				type: "patchJiraFormState",
				value: { baseUrl },
			}),
		setJiraEmail: (email: string) =>
			dispatch({
				type: "patchJiraFormState",
				value: { email },
			}),
		setJiraToken: (token: string) =>
			dispatch({
				type: "patchJiraFormState",
				value: { token },
			}),
		setYandexTrackerOrgId: (orgId: string) =>
			dispatch({
				type: "patchYandexTrackerFormState",
				value: { orgId },
			}),
		setYandexTrackerOrgType: (orgType: YandexTrackerOrgType) =>
			dispatch({
				type: "patchYandexTrackerFormState",
				value: { orgType },
			}),
		setYandexTrackerToken: (token: string) =>
			dispatch({
				type: "patchYandexTrackerFormState",
				value: { token },
			}),
		yandexTrackerFormState,
	};
}
