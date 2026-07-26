import { cleanup, render } from "@testing-library/react";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import * as React from "react";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	ChatMessageSearchNavigator,
	getChatSearchMatches,
} from "../src/components/chat/chat-message-search";

const originalScrollToDescriptor = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"scrollTo",
);
const scrollTo = vi.fn();

function NavigatorFixture({ scrollerId }: { scrollerId: string | null }) {
	const itemRef = React.useRef<HTMLDivElement>(null);
	const viewportRef = React.useRef<HTMLDivElement>(null);

	React.useLayoutEffect(() => {
		const item = itemRef.current;
		const viewport = viewportRef.current;
		if (!item || !viewport) {
			return;
		}

		Object.defineProperty(viewport, "clientHeight", {
			configurable: true,
			value: 200,
		});
		viewport.getBoundingClientRect = () => createRect({ height: 200, top: 0 });
		item.getBoundingClientRect = () => createRect({ height: 50, top: 300 });

		if (scrollerId) {
			viewport.scrollTop = 100;
		}
	}, [scrollerId]);

	return (
		<MessageScrollerProvider defaultScrollPosition="start">
			<ChatMessageSearchNavigator scrollerId={scrollerId} />
			<MessageScroller>
				<MessageScrollerViewport ref={viewportRef}>
					<MessageScrollerContent>
						<MessageScrollerItem ref={itemRef} messageId="turn-1">
							<p>Search result</p>
						</MessageScrollerItem>
					</MessageScrollerContent>
				</MessageScrollerViewport>
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const createRect = ({
	height,
	top,
}: {
	height: number;
	top: number;
}): DOMRect => ({
	bottom: top + height,
	height,
	left: 0,
	right: 0,
	toJSON: () => ({}),
	top,
	width: 0,
	x: 0,
	y: top,
});

const renderNavigator = (scrollerId: string | null) =>
	render(<NavigatorFixture scrollerId={scrollerId} />);

describe("getChatSearchMatches", () => {
	it("targets the stable scroller row that contains each matching message", () => {
		const userMessage: UIMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Question" }],
		};
		const assistantMessage: UIMessage = {
			id: "assistant-1",
			role: "assistant",
			parts: [{ type: "text", text: "Matching answer" }],
		};

		expect(
			getChatSearchMatches([userMessage, assistantMessage], "matching answer"),
		).toEqual([
			{
				messageId: "assistant-1",
				scrollerId: "user-1",
				text: "Matching answer",
			},
		]);
	});
});

describe("ChatMessageSearchNavigator", () => {
	beforeEach(() => {
		scrollTo.mockClear();
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: scrollTo,
			writable: true,
		});
	});

	afterEach(() => {
		cleanup();
	});

	afterAll(() => {
		if (originalScrollToDescriptor) {
			Object.defineProperty(
				HTMLElement.prototype,
				"scrollTo",
				originalScrollToDescriptor,
			);
			return;
		}

		Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
	});

	it("uses MessageScroller to reveal the active search result", () => {
		const view = renderNavigator(null);
		scrollTo.mockClear();
		view.rerender(<NavigatorFixture scrollerId="turn-1" />);

		expect(scrollTo).toHaveBeenCalledWith({
			behavior: "smooth",
			top: 325,
		});
	});

	it("does not issue a scroll command without an active result", () => {
		renderNavigator(null);

		expect(scrollTo).not.toHaveBeenCalled();
	});
});
