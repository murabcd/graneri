import {
	getDesktopPermissionsStatus,
	openDesktopPermissionSettings,
	requestDesktopPermission,
} from "@workspace/platform/desktop";
import type { DesktopPermissionState } from "@workspace/platform/desktop-bridge";
import * as React from "react";

const getAccessibilityState = (
	status: Awaited<ReturnType<typeof getDesktopPermissionsStatus>>,
): DesktopPermissionState => {
	const permission = status?.permissions.find(
		(entry) => entry.id === "accessibility",
	);
	if (!permission) {
		throw new Error("Accessibility permission is unavailable.");
	}
	return permission.state;
};

const getErrorMessage = (cause: unknown, fallback: string) =>
	cause instanceof Error ? cause.message : fallback;

export function useDesktopAccessibilityPermission(enabled: boolean) {
	const [state, setState] = React.useState<DesktopPermissionState | null>(null);
	const [isLoaded, setIsLoaded] = React.useState(false);
	const [isRequesting, setIsRequesting] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const operationSequenceRef = React.useRef(0);
	const runAction = React.useCallback(
		async (
			action: () => ReturnType<typeof getDesktopPermissionsStatus>,
			fallbackError: string,
		) => {
			const sequence = ++operationSequenceRef.current;
			setError(null);
			setIsRequesting(true);
			try {
				const status = await action();
				if (sequence === operationSequenceRef.current) {
					setState(getAccessibilityState(status));
				}
			} catch (cause) {
				if (sequence === operationSequenceRef.current) {
					setError(getErrorMessage(cause, fallbackError));
				}
			} finally {
				if (sequence === operationSequenceRef.current) {
					setIsRequesting(false);
				}
			}
		},
		[],
	);

	const refresh = React.useCallback(() => {
		const sequence = ++operationSequenceRef.current;
		void getDesktopPermissionsStatus()
			.then((status) => {
				if (sequence !== operationSequenceRef.current) return;
				setState(getAccessibilityState(status));
				setError(null);
				setIsLoaded(true);
			})
			.catch((cause: unknown) => {
				if (sequence !== operationSequenceRef.current) return;
				setState(null);
				setError(
					getErrorMessage(cause, "Could not check Accessibility permission."),
				);
				setIsLoaded(true);
			});
	}, []);

	React.useEffect(() => {
		if (!enabled) return;
		refresh();
		window.addEventListener("focus", refresh);
		return () => {
			operationSequenceRef.current += 1;
			window.removeEventListener("focus", refresh);
		};
	}, [enabled, refresh]);

	const request = React.useCallback(
		async () =>
			await runAction(
				() => requestDesktopPermission("accessibility"),
				"Could not open Accessibility settings.",
			),
		[runAction],
	);

	const openSettings = React.useCallback(
		async () =>
			await runAction(async () => {
				await openDesktopPermissionSettings("accessibility");
				return await getDesktopPermissionsStatus();
			}, "Could not open Accessibility settings."),
		[runAction],
	);

	return { error, isLoaded, isRequesting, openSettings, request, state };
}
