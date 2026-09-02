"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { MicIcon, SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";
import type {
	LiveTranscriptState,
	SystemAudioCaptureStatus,
	TranscriptRecoveryStatus,
	TranscriptUtterance,
} from "@/lib/transcript";
import {
	createEmptyLiveTranscriptState,
	createSystemAudioCaptureStatus,
	createTranscriptRecoveryStatus,
} from "@/lib/transcript";
import { transcriptionSessionManager } from "@/lib/transcription-session-manager";

type SpeechInputProps = ComponentProps<typeof Button> & {
	autoStartKey?: string | number | null;
	lang?: string;
	onListeningChange?: (isListening: boolean) => void;
	onLiveTranscriptChange?: (state: LiveTranscriptState) => void;
	onRecoveryStatusChange?: (status: TranscriptRecoveryStatus) => void;
	onSystemAudioStatusChange?: (status: SystemAudioCaptureStatus) => void;
	onUtterance?: (utterance: TranscriptUtterance) => void;
	scopeKey?: string | null;
};

const pulseAnimationDelays = ["0s", "0.3s", "0.6s"] as const;

const getScopedSpeechInputState = (
	session: ReturnType<typeof useTranscriptionSession>,
	scopeKey: string | null,
) => {
	const isScopedSession = session.scopeKey === scopeKey;
	const isListening = isScopedSession ? session.isListening : false;
	const isConnecting = isScopedSession ? session.isConnecting : false;
	return {
		hasActiveSessionInDifferentScope:
			session.scopeKey !== null &&
			session.scopeKey !== scopeKey &&
			(session.isListening || session.isConnecting),
		isActive: isListening || isConnecting,
		isConnecting,
		isListening,
		liveTranscript: isScopedSession
			? session.liveTranscript
			: createEmptyLiveTranscriptState(),
		recoveryStatus: isScopedSession
			? session.recoveryStatus
			: createTranscriptRecoveryStatus(),
		systemAudioStatus: isScopedSession
			? session.systemAudioStatus
			: createSystemAudioCaptureStatus(),
	};
};

const toggleSpeechInput = async ({
	isActive,
	isAvailable,
	lang,
	scopeKey,
	sessionIsActive,
}: {
	isActive: boolean;
	isAvailable: boolean;
	lang?: string;
	scopeKey: string | null;
	sessionIsActive: boolean;
}) => {
	if (!isAvailable) {
		return;
	}
	if (isActive) {
		await transcriptionSessionManager.controller.stop({
			reason: "speech-input-active-toggle",
		});
		return;
	}
	if (sessionIsActive) {
		await transcriptionSessionManager.controller.stop({
			reason: "speech-input-cross-scope-stop",
		});
	}
	transcriptionSessionManager.controller.configure({
		autoStartKey: null,
		lang,
		scopeKey,
	});
	await transcriptionSessionManager.controller.start();
};

function useSynchronizedCallbackValue<T>(
	callback: ((value: T) => void) | undefined,
	value: T,
) {
	useEffect(() => {
		callback?.(value);
	}, [callback, value]);
}

export const SpeechInput = ({
	autoStartKey,
	className,
	lang,
	onListeningChange,
	onLiveTranscriptChange,
	onRecoveryStatusChange,
	onSystemAudioStatusChange,
	onUtterance,
	scopeKey = null,
	size,
	...props
}: SpeechInputProps) => {
	const session = useTranscriptionSession();
	const scopedState = getScopedSpeechInputState(session, scopeKey);
	const tooltipLabel = scopedState.isActive
		? "Stop transcription"
		: "Start transcription";

	useEffect(() => {
		const configuredScopeKey = scopedState.hasActiveSessionInDifferentScope
			? session.scopeKey
			: scopeKey;
		transcriptionSessionManager.controller.configure({
			autoStartKey: scopedState.hasActiveSessionInDifferentScope
				? null
				: autoStartKey,
			lang,
			scopeKey: configuredScopeKey,
		});
	}, [
		autoStartKey,
		scopedState.hasActiveSessionInDifferentScope,
		lang,
		scopeKey,
		session.scopeKey,
	]);

	useSynchronizedCallbackValue(onListeningChange, scopedState.isListening);
	useSynchronizedCallbackValue(
		onLiveTranscriptChange,
		scopedState.liveTranscript,
	);
	useSynchronizedCallbackValue(
		onSystemAudioStatusChange,
		scopedState.systemAudioStatus,
	);
	useSynchronizedCallbackValue(
		onRecoveryStatusChange,
		scopedState.recoveryStatus,
	);

	useEffect(() => {
		if (!onUtterance) {
			return;
		}

		return transcriptionSessionManager.store.subscribeToEvents((event) => {
			if (event.type === "session.utterance_committed") {
				onUtterance(event.utterance);
			}
		});
	}, [onUtterance]);

	return (
		<div className="relative inline-flex items-center justify-center">
			{scopedState.isListening &&
				pulseAnimationDelays.map((delay) => (
					<div
						className="absolute inset-0 animate-ping rounded-full border-2 border-destructive/30"
						key={delay}
						style={{
							animationDelay: delay,
							animationDuration: "0.9s",
						}}
					/>
				))}

			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						size={size}
						className={cn(
							"relative z-10 rounded-full transition-all duration-300",
							scopedState.isActive
								? "!bg-destructive/15 !text-destructive hover:!bg-destructive/20 hover:!text-destructive"
								: null,
							size === "icon-sm" && "size-8",
							!session.isAvailable && "cursor-not-allowed",
							className,
						)}
						aria-disabled={!session.isAvailable}
						aria-label={tooltipLabel}
						onClick={() =>
							void toggleSpeechInput({
								isActive: scopedState.isActive,
								isAvailable: session.isAvailable,
								lang,
								scopeKey,
								sessionIsActive: session.isListening || session.isConnecting,
							})
						}
						{...props}
					>
						{scopedState.isActive ? (
							<SquareIcon className="size-4 text-current" />
						) : (
							<MicIcon className="size-4 text-current" />
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{tooltipLabel}</TooltipContent>
			</Tooltip>
		</div>
	);
};
