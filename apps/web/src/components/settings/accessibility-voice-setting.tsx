import { useDesktopAccessibilityPermission } from "@/hooks/use-desktop-accessibility-permission";
import { SettingsSwitchRow } from "./settings-switch-row";

export function AccessibilityVoiceSetting() {
	const permission = useDesktopAccessibilityPermission(true);
	const isGranted = permission.state === "granted";

	return (
		<div className="space-y-2">
			<SettingsSwitchRow
				id="settings-accessibility-speaker-names"
				label="See who's speaking"
				checked={isGranted}
				disabled={!permission.isLoaded || permission.isRequesting}
				onCheckedChange={(checked) => {
					void (checked ? permission.request() : permission.openSettings());
				}}
			/>
			{permission.error ? (
				<p role="alert" className="text-xs text-destructive">
					{permission.error}
				</p>
			) : null}
		</div>
	);
}
