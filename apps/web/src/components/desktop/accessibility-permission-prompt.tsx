import {
	Dialog,
	DialogContent,
	DialogDescription,
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
				overlayClassName="bg-black/75 backdrop-blur-[3px]"
				className="gap-0 rounded-[18px] bg-[#292929] p-2 font-[system-ui] text-white ring-1 ring-white/10 sm:max-w-sm"
			>
				<button
					type="button"
					className="absolute z-60 rounded-full bg-[#383838] px-4 py-2 text-sm text-white hover:bg-[#484848] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
					style={{
						top: "calc(50% - 50vh + 1rem)",
						right: "calc(50% - 50vw + 1rem)",
					}}
					onClick={dismiss}
				>
					Remind me later
				</button>
				<img
					src="/accessibility-speakers.png"
					alt=""
					className="aspect-352/203 w-full rounded-xl object-cover"
				/>
				<div className="flex flex-col gap-3 p-2 pt-5">
					<div className="space-y-2">
						<DialogTitle className="font-serif text-[24px] leading-7 font-normal">
							See who's speaking
						</DialogTitle>
						<DialogDescription className="text-pretty text-[14px] leading-[18px] tracking-[0.01em] text-neutral-400">
							Graneri needs Accessibility permission to identify speakers by
							name. Until you enable it, your transcripts won’t clearly show who
							said what.
						</DialogDescription>
						{permission.error ? (
							<p role="alert" className="text-sm text-red-300">
								{permission.error}
							</p>
						) : null}
					</div>
					<div className="flex justify-end pt-2">
						<button
							type="button"
							disabled={permission.isRequesting}
							onClick={() => void permission.request()}
							className="rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 disabled:opacity-60"
						>
							{permission.isRequesting ? "Opening…" : "Enable"}
						</button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
