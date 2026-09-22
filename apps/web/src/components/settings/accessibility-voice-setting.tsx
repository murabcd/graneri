import { Button } from "@workspace/ui/components/button";
import { Field, FieldContent } from "@workspace/ui/components/field";
import { Label } from "@workspace/ui/components/label";
import { useDesktopAccessibilityPermission } from "@/hooks/use-desktop-accessibility-permission";

export function AccessibilityVoiceSetting() {
	const permission = useDesktopAccessibilityPermission(true);
	const isGranted = permission.state === "granted";

	return (
		<Field
			orientation="responsive"
			className="@md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-center"
		>
			<FieldContent>
				<Label>See who's speaking</Label>
				<p className="text-xs text-muted-foreground">
					Allow Accessibility to identify speakers by name in meetings.
				</p>
				{permission.error ? (
					<p role="alert" className="text-xs text-destructive">
						{permission.error}
					</p>
				) : null}
			</FieldContent>
			<Button
				type="button"
				variant={isGranted ? "outline" : "default"}
				size="sm"
				className="w-full @md/field-group:w-56"
				disabled={!permission.isLoaded || permission.isRequesting || isGranted}
				onClick={() => void permission.request()}
			>
				{isGranted
					? "Enabled"
					: permission.isRequesting
						? "Opening…"
						: "Enable Accessibility"}
			</Button>
		</Field>
	);
}
