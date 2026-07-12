import {
	getDesktopPermissionsStatus,
	openDesktopPermissionSettings,
	requestDesktopPermission,
} from "@workspace/platform/desktop";
import type {
	DesktopPermissionId,
	DesktopPermissionState,
	DesktopPermissionsStatus,
} from "@workspace/platform/desktop-bridge";
import * as React from "react";

export type DesktopPermissionRow = {
	id: DesktopPermissionId;
	description: string;
	label: string;
	state: DesktopPermissionState;
	required: boolean;
	canRequest: boolean;
	canOpenSystemSettings: boolean;
};

type DesktopPermissionsSessionPhase =
	| "inactive"
	| "loading"
	| "ready"
	| "updating"
	| "completing"
	| "failed";

type DesktopPermissionsSessionState = {
	activePermissionId: DesktopPermissionId | null;
	error: string | null;
	phase: DesktopPermissionsSessionPhase;
	status: DesktopPermissionsStatus | null;
};

type DesktopPermissionsSessionAction =
	| { type: "reset" }
	| { type: "loadStarted" }
	| { type: "permissionUpdateStarted"; permissionId: DesktopPermissionId }
	| { type: "completionStarted" }
	| { type: "statusReceived"; status: DesktopPermissionsStatus }
	| { type: "failed"; message: string };

export type DesktopPermissionsSessionDependencies = {
	getStatus: () => Promise<DesktopPermissionsStatus | null>;
	openSettings: (permissionId: DesktopPermissionId) => Promise<boolean>;
	request: (
		permissionId: DesktopPermissionId,
	) => Promise<DesktopPermissionsStatus | null>;
};

type UseDesktopPermissionsSessionOptions = {
	complete: () => Promise<unknown>;
	dependencies?: DesktopPermissionsSessionDependencies;
	enabled: boolean;
	isMac: boolean;
};

const INITIAL_STATE: DesktopPermissionsSessionState = {
	activePermissionId: null,
	error: null,
	phase: "inactive",
	status: null,
};

const DEFAULT_DEPENDENCIES: DesktopPermissionsSessionDependencies = {
	getStatus: getDesktopPermissionsStatus,
	openSettings: openDesktopPermissionSettings,
	request: requestDesktopPermission,
};

const DESKTOP_PERMISSION_LABELS: Record<DesktopPermissionId, string> = {
	microphone: "Transcribe me",
	systemAudio: "Transcribe others",
};

const desktopPermissionsSessionReducer = (
	state: DesktopPermissionsSessionState,
	action: DesktopPermissionsSessionAction,
): DesktopPermissionsSessionState => {
	switch (action.type) {
		case "reset":
			return INITIAL_STATE;
		case "loadStarted":
			return {
				...state,
				activePermissionId: null,
				error: null,
				phase: "loading",
			};
		case "permissionUpdateStarted":
			return {
				...state,
				activePermissionId: action.permissionId,
				error: null,
				phase: "updating",
			};
		case "completionStarted":
			return {
				...state,
				activePermissionId: null,
				error: null,
				phase: "completing",
			};
		case "statusReceived":
			return {
				activePermissionId: null,
				error: null,
				phase: "ready",
				status: action.status,
			};
		case "failed":
			return {
				...state,
				activePermissionId: null,
				error: action.message,
				phase: "failed",
			};
	}
};

const requirePermissionsStatus = (
	status: DesktopPermissionsStatus | null,
): DesktopPermissionsStatus => {
	if (!status) {
		throw new Error("Desktop permissions are unavailable.");
	}

	return status;
};

const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

export const useDesktopPermissionsSession = ({
	complete,
	dependencies = DEFAULT_DEPENDENCIES,
	enabled,
	isMac,
}: UseDesktopPermissionsSessionOptions) => {
	const [state, dispatch] = React.useReducer(
		desktopPermissionsSessionReducer,
		INITIAL_STATE,
	);
	const operationSequenceRef = React.useRef(0);

	const refresh = React.useCallback(
		async (showLoading: boolean) => {
			const operationSequence = ++operationSequenceRef.current;
			if (showLoading) {
				dispatch({ type: "loadStarted" });
			}

			try {
				const status = requirePermissionsStatus(await dependencies.getStatus());
				if (operationSequence === operationSequenceRef.current) {
					dispatch({ type: "statusReceived", status });
				}
			} catch (error) {
				if (operationSequence === operationSequenceRef.current) {
					dispatch({
						type: "failed",
						message: getErrorMessage(
							error,
							"Failed to load desktop permissions.",
						),
					});
				}
			}
		},
		[dependencies],
	);

	React.useEffect(() => {
		if (!enabled) {
			operationSequenceRef.current += 1;
			dispatch({ type: "reset" });
			return;
		}

		void refresh(true);
	}, [enabled, refresh]);

	React.useEffect(() => {
		if (!enabled) {
			return;
		}

		const refreshAfterSettingsChange = () => {
			void refresh(false);
		};

		window.addEventListener("focus", refreshAfterSettingsChange);
		return () => {
			window.removeEventListener("focus", refreshAfterSettingsChange);
		};
	}, [enabled, refresh]);

	const handleRequestPermission = React.useCallback(
		(permissionId: DesktopPermissionId) => {
			const operationSequence = ++operationSequenceRef.current;
			dispatch({ type: "permissionUpdateStarted", permissionId });

			void dependencies
				.request(permissionId)
				.then(requirePermissionsStatus)
				.then((status) => {
					if (operationSequence === operationSequenceRef.current) {
						dispatch({ type: "statusReceived", status });
					}
				})
				.catch((error: unknown) => {
					if (operationSequence === operationSequenceRef.current) {
						dispatch({
							type: "failed",
							message: getErrorMessage(
								error,
								"Failed to request desktop permission.",
							),
						});
					}
				});
		},
		[dependencies],
	);

	const handleOpenSettings = React.useCallback(
		(permissionId: DesktopPermissionId) => {
			const operationSequence = ++operationSequenceRef.current;
			dispatch({ type: "permissionUpdateStarted", permissionId });

			void dependencies
				.openSettings(permissionId)
				.then((opened) => {
					if (!opened) {
						throw new Error("Desktop permissions are unavailable.");
					}

					return dependencies.getStatus();
				})
				.then(requirePermissionsStatus)
				.then((status) => {
					if (operationSequence === operationSequenceRef.current) {
						dispatch({ type: "statusReceived", status });
					}
				})
				.catch((error: unknown) => {
					if (operationSequence === operationSequenceRef.current) {
						dispatch({
							type: "failed",
							message: getErrorMessage(
								error,
								"Failed to open system settings.",
							),
						});
					}
				});
		},
		[dependencies],
	);

	const handleComplete = React.useCallback(() => {
		const operationSequence = ++operationSequenceRef.current;
		dispatch({ type: "completionStarted" });

		void complete().catch((error: unknown) => {
			if (operationSequence === operationSequenceRef.current) {
				dispatch({
					type: "failed",
					message: getErrorMessage(
						error,
						"Failed to finish desktop onboarding.",
					),
				});
			}
		});
	}, [complete]);

	const permissionRows: DesktopPermissionRow[] = (
		state.status?.permissions ?? []
	).map((permission) => ({
		...permission,
		label: DESKTOP_PERMISSION_LABELS[permission.id],
	}));
	const requiredPermissionRows = permissionRows.filter(
		(permission) => permission.required,
	);
	const systemAudioPermission = permissionRows.find(
		(permission) => permission.id === "systemAudio",
	);
	const isReady =
		requiredPermissionRows.length > 0 &&
		requiredPermissionRows.every(
			(permission) => permission.state === "granted",
		) &&
		(!isMac ||
			!systemAudioPermission ||
			systemAudioPermission.state === "granted" ||
			systemAudioPermission.state === "unsupported");

	return {
		activePermissionId: state.activePermissionId,
		error: state.error,
		handleComplete,
		handleOpenSettings,
		handleRequestPermission,
		isCompleting: state.phase === "completing",
		isReady,
		isRefreshing: state.phase === "loading" || state.phase === "updating",
		permissionRows,
		shouldShow: enabled && (permissionRows.length > 0 || state.error !== null),
		status: state.status,
	};
};
