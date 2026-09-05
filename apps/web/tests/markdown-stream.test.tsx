import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownStream } from "../src/components/chat/markdown-stream";

const LONG_CODE_LINE = `const message = "${"long-code-content-".repeat(20)}";`;

describe("MarkdownStream code blocks", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		cleanup();
	});

	it("renders long code without a height cap and toggles wrapping inside a stable block", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<TooltipProvider>
				<MarkdownStream mode="static">{`\`\`\`tsx\n${LONG_CODE_LINE}\n\`\`\``}</MarkdownStream>
			</TooltipProvider>,
		);

		const block = container.querySelector<HTMLElement>(".graneri-code-block");
		const body = container.querySelector<HTMLElement>(
			'[data-streamdown="code-block-body"]',
		);
		const wrapButton = screen.getByRole("button", {
			name: "Disable word wrap",
		});

		expect(block).not.toBeNull();
		expect(body?.style.maxHeight).toBe("");
		expect(block?.dataset.codeWrap).toBe("true");
		expect(screen.getAllByText("tsx")).toHaveLength(2);
		expect(screen.getByText(LONG_CODE_LINE)).not.toBeNull();
		Object.defineProperty(block as HTMLElement, "getBoundingClientRect", {
			value: () => ({ height: 212 }),
		});

		await user.click(wrapButton);

		expect(container.querySelector(".graneri-code-block")).toBe(block);
		expect(block?.style.height).toBe("212px");
		expect(block?.dataset.codeWrap).toBe("false");
		const unwrappedButton = screen.getByRole("button", {
			name: "Enable word wrap",
		});
		expect(unwrappedButton.getAttribute("aria-pressed")).toBe("false");
	});

	it("keeps inline code inline", () => {
		const { container } = render(
			<MarkdownStream mode="static">Use `streamdown` here.</MarkdownStream>,
		);

		expect(container.querySelector(".graneri-code-block")).toBeNull();
		const inlineCode = screen.getByText("streamdown");
		expect(inlineCode.tagName).toBe("CODE");
	});

	it("disables custom code controls while the response is streaming", () => {
		render(
			<TooltipProvider>
				<MarkdownStream isAnimating mode="streaming">
					{"```ts\nconst value = 1;\n```"}
				</MarkdownStream>
			</TooltipProvider>,
		);

		expect(
			screen
				.getByRole("button", { name: "Disable word wrap" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Copy code" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("keeps animation until the completed response finishes draining", async () => {
		const view = render(
			<MarkdownStream isAnimating mode="streaming">
				{"One"}
			</MarkdownStream>,
		);

		view.rerender(
			<MarkdownStream isAnimating mode="streaming">
				{"One two three"}
			</MarkdownStream>,
		);

		expect(view.container.querySelector("[data-sd-animate]")).not.toBeNull();

		view.rerender(
			<MarkdownStream mode="static">{"One two three"}</MarkdownStream>,
		);

		expect(view.container.querySelector("[data-sd-animate]")).not.toBeNull();
		await waitFor(() => {
			expect(view.container.querySelector("[data-sd-animate]")).toBeNull();
			expect(view.container.textContent).toBe("One two three");
		});
	});

	it("copies code and shows success", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(globalThis.navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		render(
			<TooltipProvider>
				<MarkdownStream mode="static">
					{"```ts\nconst value = 1;\n```"}
				</MarkdownStream>
			</TooltipProvider>,
		);

		const copyButton = screen.getByRole("button", { name: "Copy code" });

		fireEvent.click(copyButton);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith("const value = 1;");
		});
		expect(
			await screen.findByRole("button", { name: "Copied" }),
		).not.toBeNull();
	});
});
