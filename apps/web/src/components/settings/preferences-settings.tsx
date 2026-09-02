import {
	getDesktopPreferences,
	isDesktopRuntime,
	setDesktopLaunchAtLogin,
} from "@workspace/platform/desktop";
import type { DesktopPreferences } from "@workspace/platform/desktop-bridge";
import {
	Field,
	FieldContent,
	FieldGroup,
} from "@workspace/ui/components/field";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import {
	DEFAULT_FOLLOW_UP_BEHAVIOR,
	FOLLOW_UP_BEHAVIOR_OPTIONS,
	parseFollowUpBehavior,
} from "@/lib/follow-up-behavior";
import { logError } from "@/lib/logger";
import {
	DEFAULT_SEND_SHORTCUT,
	parseSendShortcut,
	SEND_SHORTCUT_OPTIONS,
} from "@/lib/send-shortcut";
import { SettingsSwitchRow } from "./settings-switch-row";

type DesktopLaunchPreferenceState =
	| { status: "unavailable" }
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; preferences: DesktopPreferences; isSaving: boolean };

const getInitialDesktopState = (): DesktopLaunchPreferenceState =>
	isDesktopRuntime() ? { status: "loading" } : { status: "unavailable" };

export function PreferencesSettings() {
	const [desktopState, setDesktopState] =
		useState<DesktopLaunchPreferenceState>(getInitialDesktopState);
	const [isSavingSendShortcut, setIsSavingSendShortcut] = useState(false);
	const [isSavingFollowUpBehavior, setIsSavingFollowUpBehavior] =
		useState(false);
	const { updateUserPreferences, userPreferences } = useUserPreferences();

	useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		let isCancelled = false;
		void getDesktopPreferences()
			.then((preferences) => {
				if (!isCancelled) {
					setDesktopState({ status: "ready", preferences, isSaving: false });
				}
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to load desktop preferences",
				});
				if (!isCancelled) {
					setDesktopState({ status: "error" });
					toast.error("Failed to load desktop preferences");
				}
			});

		return () => {
			isCancelled = true;
		};
	}, []);

	const handleLaunchAtLoginChange = async (value: boolean) => {
		if (desktopState.status !== "ready") {
			return;
		}

		const previousPreferences = desktopState.preferences;
		setDesktopState({
			status: "ready",
			preferences: { ...previousPreferences, launchAtLogin: value },
			isSaving: true,
		});

		try {
			const preferences = await setDesktopLaunchAtLogin(value);
			setDesktopState({ status: "ready", preferences, isSaving: false });
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to update launch at login preference",
			});
			setDesktopState({
				status: "ready",
				preferences: previousPreferences,
				isSaving: false,
			});
			toast.error("Failed to update launch at login preference");
		}
	};

	const handleSendShortcutChange = async (value: string) => {
		setIsSavingSendShortcut(true);
		try {
			await updateUserPreferences({ sendShortcut: parseSendShortcut(value) });
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to update send shortcut",
			});
			toast.error("Failed to update send shortcut");
		} finally {
			setIsSavingSendShortcut(false);
		}
	};

	const handleFollowUpBehaviorChange = async (value: string) => {
		setIsSavingFollowUpBehavior(true);
		try {
			await updateUserPreferences({
				followUpBehavior: parseFollowUpBehavior(value),
			});
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to update follow-up behavior",
			});
			toast.error("Failed to update follow-up behavior");
		} finally {
			setIsSavingFollowUpBehavior(false);
		}
	};

	if (desktopState.status === "loading") {
		return <div className="py-4" aria-hidden="true" />;
	}

	return (
		<div className="py-4">
			<FieldGroup className="gap-4">
				{desktopState.status !== "unavailable" ? (
					<SettingsSwitchRow
						id="settings-launch-at-login"
						label="Launch at login"
						checked={
							desktopState.status === "ready" &&
							desktopState.preferences.launchAtLogin
						}
						disabled={
							desktopState.status !== "ready" ||
							desktopState.isSaving ||
							!desktopState.preferences.canLaunchAtLogin
						}
						onCheckedChange={handleLaunchAtLoginChange}
					/>
				) : null}
				<Field
					orientation="responsive"
					className="@md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-center"
				>
					<FieldContent>
						<Label>Send shortcut</Label>
					</FieldContent>
					<Select
						value={userPreferences?.sendShortcut ?? DEFAULT_SEND_SHORTCUT}
						onValueChange={handleSendShortcutChange}
						disabled={userPreferences === undefined || isSavingSendShortcut}
					>
						<SelectTrigger
							size="sm"
							className="w-full cursor-pointer justify-between @md/field-group:w-48"
							aria-label="Select send shortcut"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="end">
							{SEND_SHORTCUT_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Field
					orientation="responsive"
					className="@md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-center"
				>
					<FieldContent>
						<Label>Follow-up behavior</Label>
					</FieldContent>
					<Select
						value={
							userPreferences?.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR
						}
						onValueChange={handleFollowUpBehaviorChange}
						disabled={userPreferences === undefined || isSavingFollowUpBehavior}
					>
						<SelectTrigger
							size="sm"
							className="w-full cursor-pointer justify-between @md/field-group:w-48"
							aria-label="Select follow-up behavior"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="end">
							{FOLLOW_UP_BEHAVIOR_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			</FieldGroup>
		</div>
	);
}
