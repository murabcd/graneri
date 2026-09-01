import { Button } from "@workspace/ui/components/button";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";
import {
	ASSISTANT_CHAT_CONTENT_CLASS,
	CHAT_MESSAGE_MAX_WIDTH_CLASS,
	USER_CHAT_BUBBLE_CLASS,
} from "@/components/chat/message-layout";
import type { createTranscriptDisplayEntries } from "@/lib/transcript";
import { formatTranscriptElapsed } from "@/lib/transcript";
import { NOTE_POPOVER_SCROLLER_BUTTON_CLASS } from "./note-popover-scroll";
import type { NoteTranscriptPanelState } from "./note-transcript-panel-state";

const TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD = 32;
const TRANSCRIPT_INITIAL_WINDOW_SIZE = 32;

type TranscriptDisplayEntry = ReturnType<
	typeof createTranscriptDisplayEntries
>[number];

export function NoteTranscriptPanel({
	displayTranscriptEntries,
	state,
	transcriptStartedAt,
}: {
	displayTranscriptEntries: TranscriptDisplayEntry[];
	state: NoteTranscriptPanelState;
	transcriptStartedAt: number | null;
}) {
	const deferredDisplayTranscriptEntries = React.useDeferredValue(
		displayTranscriptEntries,
	);
	const isDeferringTranscriptEntries =
		deferredDisplayTranscriptEntries !== displayTranscriptEntries;
	const transcriptEntryCount = deferredDisplayTranscriptEntries.length;
	const [
		fullyRenderedTranscriptEntryCount,
		setFullyRenderedTranscriptEntryCount,
	] = React.useReducer(
		(current: number, next: number | ((current: number) => number)) =>
			typeof next === "function" ? next(current) : next,
		transcriptEntryCount > TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD
			? Math.min(transcriptEntryCount, TRANSCRIPT_INITIAL_WINDOW_SIZE)
			: transcriptEntryCount,
	);

	React.useEffect(() => {
		const currentTranscriptEntryCount = deferredDisplayTranscriptEntries.length;
		if (
			currentTranscriptEntryCount <= TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD
		) {
			setFullyRenderedTranscriptEntryCount(currentTranscriptEntryCount);
			return;
		}

		const promoteFullTranscriptEntries = () => {
			React.startTransition(() => {
				setFullyRenderedTranscriptEntryCount(currentTranscriptEntryCount);
			});
		};

		if ("requestIdleCallback" in globalThis) {
			const idleCallbackId = globalThis.requestIdleCallback(
				promoteFullTranscriptEntries,
				{ timeout: 250 },
			);

			return () => {
				globalThis.cancelIdleCallback(idleCallbackId);
			};
		}

		const timeoutId = globalThis.setTimeout(promoteFullTranscriptEntries, 32);
		return () => {
			globalThis.clearTimeout(timeoutId);
		};
	}, [deferredDisplayTranscriptEntries.length]);
	const renderFullTranscriptEntries =
		transcriptEntryCount <= TRANSCRIPT_PROGRESSIVE_RENDER_THRESHOLD ||
		fullyRenderedTranscriptEntryCount === transcriptEntryCount;
	const renderedTranscriptEntries = renderFullTranscriptEntries
		? deferredDisplayTranscriptEntries
		: deferredDisplayTranscriptEntries.slice(
				-fullyRenderedTranscriptEntryCount,
			);
	const isProgressivelyRenderingTranscript =
		!renderFullTranscriptEntries &&
		deferredDisplayTranscriptEntries.length > renderedTranscriptEntries.length;

	if (state.status === "loading") {
		return <div className="flex flex-1" aria-hidden="true" />;
	}

	if (state.status === "empty") {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-center text-sm font-medium tracking-tight">
					{state.mode === "listening" ? "Listening…" : "Transcript paused"}
				</p>
			</div>
		);
	}

	return (
		<MessageScrollerProvider autoScroll={state.mode === "listening"}>
			<div className="relative flex min-h-0 w-full flex-1 flex-col">
				<MessageScroller className="min-h-0 w-full flex-1">
					<MessageScrollerViewport className="pr-4">
						<MessageScrollerContent className="gap-4 pb-12">
							{isDeferringTranscriptEntries &&
							deferredDisplayTranscriptEntries.length === 0 ? (
								<MessageScrollerItem
									aria-hidden="true"
									className="flex flex-1 py-12"
									messageId="transcript-deferred-placeholder"
								/>
							) : null}
							{isProgressivelyRenderingTranscript ? (
								<MessageScrollerItem
									aria-hidden="true"
									className="h-4"
									messageId="transcript-progressive-spacer"
								/>
							) : null}
							{renderedTranscriptEntries.map((utterance) => {
								const isUserTranscript = utterance.speaker === "you";
								const elapsed =
									transcriptStartedAt != null
										? formatTranscriptElapsed(
												utterance.startedAt - transcriptStartedAt,
											)
										: null;

								return (
									<MessageScrollerItem
										key={utterance.id}
										messageId={utterance.id}
										className={cn(
											"group/message flex w-full flex-col gap-1 transition-colors",
											isUserTranscript ? "items-end" : "items-start",
										)}
									>
										<div
											className={cn(
												CHAT_MESSAGE_MAX_WIDTH_CLASS,
												isUserTranscript
													? utterance.isLive && !utterance.liveText
														? cn(
																USER_CHAT_BUBBLE_CLASS,
																"bg-secondary/70 text-muted-foreground",
															)
														: USER_CHAT_BUBBLE_CLASS
													: utterance.isLive && !utterance.liveText
														? cn(
																ASSISTANT_CHAT_CONTENT_CLASS,
																"text-muted-foreground",
															)
														: ASSISTANT_CHAT_CONTENT_CLASS,
											)}
											style={{
												containIntrinsicSize: "120px",
												contentVisibility: "auto",
											}}
										>
											{utterance.liveText ? (
												<p className="whitespace-pre-wrap">
													{utterance.committedText}{" "}
													<span className="relative top-[0.5px] text-muted-foreground">
														{utterance.liveText}
													</span>
												</p>
											) : (
												<p className="whitespace-pre-wrap">{utterance.text}</p>
											)}
										</div>
										{elapsed ? (
											<p className="px-1 text-[11px] font-medium tabular-nums text-muted-foreground/65">
												{elapsed}
											</p>
										) : null}
									</MessageScrollerItem>
								);
							})}
							{state.pagination.status !== "complete" ? (
								<MessageScrollerItem
									className="flex justify-center py-2"
									messageId="transcript-load-more"
								>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={state.pagination.status === "loading"}
										onClick={state.pagination.loadMore}
									>
										{state.pagination.status === "loading"
											? "Loading transcript…"
											: "Load more transcript"}
									</Button>
								</MessageScrollerItem>
							) : null}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					{renderedTranscriptEntries.length > 0 ? (
						<MessageScrollerButton
							aria-label="Scroll to latest transcript"
							className={NOTE_POPOVER_SCROLLER_BUTTON_CLASS}
						/>
					) : null}
				</MessageScroller>
			</div>
		</MessageScrollerProvider>
	);
}
