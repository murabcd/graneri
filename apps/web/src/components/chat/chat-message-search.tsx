import { isDesktopRuntime } from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useMessageScroller } from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import { cn } from "cn";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import * as React from "react";
import { getChatSearchMatches } from "@/components/chat/chat-message-search-matches";
import { ensureCssHighlightStyles } from "@/lib/css-highlight-styles";
import { getCssHighlightApi } from "@/lib/css-highlights";
import { createTextMatchRanges } from "@/lib/text-search-ranges";

type MessageSearchState = {
	open: boolean;
	query: string;
	index: number;
};

type MessageSearchAction =
	| { type: "close" }
	| { type: "open" }
	| { type: "setQuery"; query: string }
	| { type: "setIndex"; index: number };

const messageSearchReducer = (
	state: MessageSearchState,
	action: MessageSearchAction,
): MessageSearchState => {
	if (action.type === "open") return { ...state, open: true };
	if (action.type === "close") return { open: false, query: "", index: 0 };
	if (action.type === "setQuery") {
		return { ...state, query: action.query, index: 0 };
	}
	return { ...state, index: action.index };
};

const CHAT_SEARCH_MATCH_HIGHLIGHT = "chat-search-match";
const CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT = "chat-search-active-match";

const useChatSearchHighlights = ({
	activeMessageId,
	matches,
	search,
}: {
	activeMessageId: string | null;
	matches: ReturnType<typeof getChatSearchMatches>;
	search: Pick<MessageSearchState, "open" | "query">;
}) => {
	React.useEffect(() => {
		const highlightApi = getCssHighlightApi();
		if (!highlightApi) return;
		const { Highlight: HighlightConstructor, registry: highlightRegistry } =
			highlightApi;
		if (!search.open || !search.query.trim()) {
			highlightRegistry.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
			return;
		}

		ensureCssHighlightStyles();
		const matchRanges: Range[] = [];
		const activeMatchRanges: Range[] = [];
		for (const match of matches) {
			const messageElement = document.querySelector<HTMLElement>(
				`[data-chat-message-id="${CSS.escape(match.messageId)}"]`,
			);
			if (!messageElement) continue;
			const ranges = createTextMatchRanges({
				element: messageElement,
				query: search.query,
			});
			if (match.messageId === activeMessageId) {
				activeMatchRanges.push(...ranges);
				continue;
			}
			matchRanges.push(...ranges);
		}

		highlightRegistry.set(
			CHAT_SEARCH_MATCH_HIGHLIGHT,
			new HighlightConstructor(...matchRanges),
		);
		highlightRegistry.set(
			CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT,
			new HighlightConstructor(...activeMatchRanges),
		);
		return () => {
			highlightRegistry.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
		};
	}, [activeMessageId, matches, search.open, search.query]);
};

const useDesktopChatSearchShortcut = ({
	canSearch,
	dispatch,
	inputRef,
	isOpen,
}: {
	canSearch: boolean;
	dispatch: React.Dispatch<MessageSearchAction>;
	inputRef: React.RefObject<HTMLInputElement | null>;
	isOpen: boolean;
}) => {
	React.useEffect(() => {
		if (!canSearch || !isDesktopRuntime()) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key.toLowerCase() !== "f" && event.code !== "KeyF")
			) {
				return;
			}
			event.preventDefault();
			if (isOpen) {
				requestAnimationFrame(() => {
					inputRef.current?.focus();
					inputRef.current?.select();
				});
			}
			dispatch({ type: "open" });
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [canSearch, dispatch, inputRef, isOpen]);
};

export const useChatMessageSearch = ({
	canSearch,
	messages,
}: {
	canSearch: boolean;
	messages: UIMessage[];
}) => {
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const [state, dispatch] = React.useReducer(messageSearchReducer, {
		open: false,
		query: "",
		index: 0,
	});
	const matches = React.useMemo(
		() => getChatSearchMatches(messages, state.query),
		[messages, state.query],
	);
	const index =
		matches.length > 0 ? Math.min(state.index, matches.length - 1) : 0;
	const activeMatch = matches.length > 0 ? matches[index] : null;

	React.useEffect(() => {
		if (!canSearch) dispatch({ type: "close" });
	}, [canSearch]);
	React.useEffect(() => {
		if (!state.open) return;
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [state.open]);

	useChatSearchHighlights({
		activeMessageId: activeMatch?.messageId ?? null,
		matches,
		search: state,
	});
	useDesktopChatSearchShortcut({
		canSearch,
		dispatch,
		inputRef,
		isOpen: state.open,
	});

	const selectPrevious = React.useCallback(() => {
		dispatch({
			type: "setIndex",
			index:
				matches.length === 0
					? 0
					: (index - 1 + matches.length) % matches.length,
		});
	}, [index, matches.length]);
	const selectNext = React.useCallback(() => {
		dispatch({
			type: "setIndex",
			index: matches.length === 0 ? 0 : (index + 1) % matches.length,
		});
	}, [index, matches.length]);
	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				dispatch({ type: "close" });
				return;
			}
			if (event.key !== "Enter") return;
			event.preventDefault();
			if (event.shiftKey) {
				selectPrevious();
				return;
			}
			selectNext();
		},
		[selectNext, selectPrevious],
	);

	return {
		activeMatch,
		dispatch,
		handleKeyDown,
		index,
		inputRef,
		matches,
		selectNext,
		selectPrevious,
		state,
	};
};

export function ChatMessageSearchBarEntry({
	search,
}: {
	search: ReturnType<typeof useChatMessageSearch>;
}) {
	if (!search.state.open) return null;
	const matchCount = search.matches.length;
	const matchLabel =
		search.state.query.trim().length === 0
			? ""
			: matchCount > 0
				? `${search.index + 1}/${matchCount}`
				: "No results";

	return (
		<div className="fixed top-20 right-4 left-4 z-50 mx-auto flex max-w-md items-center gap-1 rounded-lg border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur md:right-8 md:left-auto md:w-80">
			<Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
			<Input
				ref={search.inputRef}
				value={search.state.query}
				onChange={(event) =>
					search.dispatch({ type: "setQuery", query: event.target.value })
				}
				onKeyDown={search.handleKeyDown}
				placeholder="Search chat"
				aria-label="Search chat"
				className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
			/>
			<span
				className={cn(
					"min-w-14 shrink-0 text-right text-xs tabular-nums",
					matchCount === 0 && search.state.query.trim().length > 0
						? "text-muted-foreground"
						: "text-foreground/70",
				)}
			>
				{matchLabel}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Previous match"
				onClick={search.selectPrevious}
			>
				<ChevronUp className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Next match"
				onClick={search.selectNext}
			>
				<ChevronDown className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				aria-label="Close chat search"
				onClick={() => search.dispatch({ type: "close" })}
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}

export function ChatMessageSearchNavigator({
	scrollerId,
}: {
	scrollerId: string | null;
}) {
	const { scrollToMessage } = useMessageScroller();
	React.useEffect(() => {
		if (!scrollerId) return;
		scrollToMessage(scrollerId, {
			align: "center",
			behavior: "smooth",
		});
	}, [scrollToMessage, scrollerId]);
	return null;
}
