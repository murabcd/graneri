import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import * as React from "react";
import { z } from "zod";
import { useDesktopAccessibilityPermission } from "@/hooks/use-desktop-accessibility-permission";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";

const dismissalStorageKey = "graneri-accessibility-prompt-dismissal";
const reminderIntervalMs = 24 * 60 * 60 * 1000;
const maximumDismissals = 3;
const dismissalSchema = z.object({
	count: z.number().int().nonnegative(),
	dismissedAt: z.number().finite(),
});

type Dismissal = z.infer<typeof dismissalSchema>;

function readDismissal(): Dismissal {
	const empty = { count: 0, dismissedAt: 0 };
	if (typeof window === "undefined") return empty;
	const stored = window.localStorage.getItem(dismissalStorageKey);
	if (!stored) return empty;
	try {
		const result = dismissalSchema.safeParse(JSON.parse(stored) as unknown);
		return result.success ? result.data : empty;
	} catch {
		return empty;
	}
}

export function AccessibilityPermissionPrompt({
	enabled,
}: {
	enabled: boolean;
}) {
	const transcriptionSession = useTranscriptionSession();
	const permission = useDesktopAccessibilityPermission(enabled);
	const [dismissal, setDismissal] = React.useState(readDismissal);

	const dismiss = () => {
		const next = {
			count: dismissal.count + 1,
			dismissedAt: Date.now(),
		};
		window.localStorage.setItem(dismissalStorageKey, JSON.stringify(next));
		setDismissal(next);
	};

	const isRecording =
		transcriptionSession.isListening || transcriptionSession.isConnecting;
	const canRemind =
		dismissal.count < maximumDismissals &&
		Date.now() - dismissal.dismissedAt >= reminderIntervalMs;
	const isOpen =
		enabled &&
		!isRecording &&
		permission.isLoaded &&
		permission.state !== "granted" &&
		canRemind;

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) dismiss();
			}}
		>
			<DialogContent
				showCloseButton={false}
				onPointerDownOutside={(event) => event.preventDefault()}
				className="gap-0 bg-card p-2 text-card-foreground"
			>
				<Button
					type="button"
					variant="secondary"
					className="absolute"
					style={{
						top: "calc(50% - 50vh + var(--spacing) * 4)",
						right: "calc(50% - 50vw + var(--spacing) * 4)",
					}}
					onClick={dismiss}
				>
					Remind me later
				</Button>
				<img
					src="/accessibility-speakers.png"
					alt=""
					className="aspect-video w-full rounded-md object-cover"
				/>
				<div className="flex flex-col gap-3 p-2 pt-5">
					<DialogHeader>
						<DialogTitle className="text-2xl leading-7">
							See who's speaking
						</DialogTitle>
						<DialogDescription className="text-pretty">
							Graneri needs Accessibility permission to identify speakers by
							name. Until you enable it, your transcripts won’t clearly show who
							said what.
						</DialogDescription>
						{permission.error ? (
							<p role="alert" className="text-sm text-destructive">
								{permission.error}
							</p>
						) : null}
					</DialogHeader>
					<div className="flex justify-end pt-2">
						<Button
							type="button"
							disabled={permission.isRequesting}
							onClick={() => void permission.request()}
						>
							{permission.isRequesting ? "Opening…" : "Enable"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
