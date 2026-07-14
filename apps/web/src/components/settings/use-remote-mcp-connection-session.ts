import {
	isDesktopRuntime,
	openDesktopExternalUrl,
} from "@workspace/platform/desktop";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";
import { logError } from "@/lib/logger";
import {
	buildRemoteMcpConnectArgs,
	isRemoteMcpConnectionFormValid,
	type RemoteMcpConnectArgs,
	type RemoteMcpConnectionFormState,
	type RemoteMcpOAuthFields,
} from "@/lib/remote-mcp-connection-form";
import type { Id } from "../../../../../convex/_generated/dataModel";

type RemoteMcpConnection = {
	sourceId: string;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
	status?: "connected" | "disconnected";
};

type RemoteMcpFormState = RemoteMcpConnectionFormState &
	Partial<RemoteMcpOAuthFields>;

type RemoteMcpConnectionSessionOptions = {
	workspaceId: Id<"workspaces"> | null;
	connection: RemoteMcpConnection | null;
	defaultFormState: RemoteMcpFormState;
	defaultDisplayName: string;
	requireEnvValue: boolean;
	connect: (args: RemoteMcpConnectArgs<Id<"workspaces">>) => Promise<unknown>;
	connectionLabel: string;
	connectedMessage: string;
	requiresOAuth: boolean;
};

const createOAuthNavigationTarget = () =>
	isDesktopRuntime() ? null : window.open("about:blank", "_blank");

const navigateToOAuthUrl = async (url: string, oauthWindow: Window | null) => {
	if (await openDesktopExternalUrl(url)) {
		oauthWindow?.close();
		return;
	}

	if (oauthWindow) {
		oauthWindow.opener = null;
		oauthWindow.location.replace(url);
		return;
	}

	window.location.assign(url);
};

const createFormState = (
	connection: RemoteMcpConnection | null,
	defaultFormState: RemoteMcpFormState,
	defaultDisplayName: string,
): RemoteMcpFormState => ({
	...defaultFormState,
	name: connection?.displayName ?? defaultDisplayName,
	baseUrl: connection?.endpoint ?? defaultFormState.baseUrl,
	envVars: [],
	...(defaultFormState.oauthClientId !== undefined
		? {
				oauthClientId: connection?.oauthClientId ?? "",
				oauthClientSecret: "",
			}
		: {}),
});

export const useRemoteMcpConnectionSession = ({
	workspaceId,
	connection,
	defaultFormState,
	defaultDisplayName,
	requireEnvValue,
	connect,
	connectionLabel,
	connectedMessage,
	requiresOAuth,
}: RemoteMcpConnectionSessionOptions) => {
	const [isOpen, setIsOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [formState, setFormState] =
		useState<RemoteMcpFormState>(defaultFormState);

	const handleOpenChange = useCallback(
		(open: boolean) => {
			setIsOpen(() => open);
			setFormState(
				open
					? createFormState(connection, defaultFormState, defaultDisplayName)
					: defaultFormState,
			);
		},
		[connection, defaultDisplayName, defaultFormState],
	);

	const patchForm = useCallback((patch: Partial<RemoteMcpFormState>) => {
		setFormState((current) => ({ ...current, ...patch }));
	}, []);

	const controls = useMemo(
		() => ({
			addEnvVar: () =>
				patchForm({
					envVars: [
						...formState.envVars,
						{ id: crypto.randomUUID(), key: "", value: "" },
					],
				}),
			removeEnvVar: (id: string) =>
				patchForm({
					envVars: formState.envVars.filter((envVar) => envVar.id !== id),
				}),
			updateEnvVar: (id: string, field: "key" | "value", value: string) =>
				patchForm({
					envVars: formState.envVars.map((envVar) =>
						envVar.id === id ? { ...envVar, [field]: value } : envVar,
					),
				}),
			setBaseUrl: (baseUrl: string) => patchForm({ baseUrl }),
			setName: (name: string) => patchForm({ name }),
			setOAuthClientId: (oauthClientId: string) => patchForm({ oauthClientId }),
			setOAuthClientSecret: (oauthClientSecret: string) =>
				patchForm({ oauthClientSecret }),
		}),
		[formState.envVars, patchForm],
	);

	const handleConnect = useCallback(async () => {
		if (!workspaceId || !isRemoteMcpConnectionFormValid(formState)) {
			return;
		}

		setIsSaving(true);
		const oauthWindow = requiresOAuth ? createOAuthNavigationTarget() : null;

		try {
			const result = await connect(
				buildRemoteMcpConnectArgs({
					workspaceId,
					formState,
					requireEnvValue,
				}),
			);

			if (requiresOAuth) {
				if (
					!result ||
					typeof result !== "object" ||
					!("authorizationUrl" in result) ||
					typeof result.authorizationUrl !== "string"
				) {
					throw new Error(`${connectionLabel} OAuth URL was not returned.`);
				}
				await navigateToOAuthUrl(result.authorizationUrl, oauthWindow);
			}

			toast.success(connectedMessage);
			handleOpenChange(false);
		} catch (error) {
			oauthWindow?.close();
			logError({
				event: "client.error",
				error,
				message: `Failed to connect ${connectionLabel}`,
			});
			toast.error(
				getConnectionErrorMessage(
					error,
					`Failed to connect ${connectionLabel}`,
				),
			);
		} finally {
			setIsSaving(false);
		}
	}, [
		connect,
		connectedMessage,
		connectionLabel,
		formState,
		handleOpenChange,
		requireEnvValue,
		requiresOAuth,
		workspaceId,
	]);

	return {
		...controls,
		connection,
		formState,
		handleConnect,
		handleOpenChange,
		isFormValid: isRemoteMcpConnectionFormValid(formState),
		isOpen,
		isSaving,
	};
};
