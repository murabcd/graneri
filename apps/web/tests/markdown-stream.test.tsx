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
		expect(block?.className).toContain(
			"[&_[data-streamdown=code-block-body]]:border-0",
		);
		expect(block?.className).toContain(
			"[&_[data-streamdown=code-block]]:rounded-lg",
		);
		expect(block?.className).toContain(
			"[&_[data-streamdown=code-block-actions]]:mr-1.5",
		);
		expect(block?.dataset.codeWrap).toBe("true");
		expect(screen.getAllByText("tsx")).toHaveLength(2);
		expect(screen.getByText(LONG_CODE_LINE)).not.toBeNull();
		expect(wrapButton.querySelector("svg")?.getAttribute("viewBox")).toBe(
			"0 0 24 24",
		);
		expect(wrapButton.classList).toContain("size-8");
		expect(wrapButton.classList).not.toContain("size-9");
		expect(wrapButton.querySelector("svg")?.classList.contains("size-4")).toBe(
			true,
		);
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
		expect(unwrappedButton.querySelector("svg")?.getAttribute("viewBox")).toBe(
			"0 0 24 24",
		);

		const copyButton = screen.getByRole("button", { name: "Copy code" });
		expect(copyButton.querySelector("svg")?.getAttribute("viewBox")).toBe(
			"0 0 24 24",
		);
		expect(copyButton.classList).toContain("size-8");
		expect(copyButton.classList).not.toContain("size-9");
		expect(copyButton.querySelector("svg")?.classList.contains("size-4")).toBe(
			true,
		);
	});

	it("keeps inline code inline", () => {
		const { container } = render(
			<MarkdownStream mode="static">Use `streamdown` here.</MarkdownStream>,
		);

		expect(container.querySelector(".graneri-code-block")).toBeNull();
		const inlineCode = screen.getByText("streamdown");
		expect(inlineCode.tagName).toBe("CODE");
		expect(inlineCode.className).toContain("graneri-inline-code");
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

	it("labels code controls with the shared tooltip treatment", async () => {
		const user = userEvent.setup();
		render(
			<TooltipProvider delayDuration={0}>
				<MarkdownStream mode="static">
					{"```ts\nconst value = 1;\n```"}
				</MarkdownStream>
			</TooltipProvider>,
		);

		await user.hover(screen.getByRole("button", { name: "Disable word wrap" }));
		expect(
			await screen.findByRole("tooltip", { name: "Disable word wrap" }),
		).not.toBeNull();
	});

	it("shows the reference copy success state before returning to copy", async () => {
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
		expect(
			copyButton.querySelector("svg")?.classList.contains("lucide-copy"),
		).toBe(true);

		fireEvent.click(copyButton);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith("const value = 1;");
		});
		const copiedButton = await screen.findByRole("button", { name: "Copied" });
		expect(
			copiedButton.querySelector("svg")?.classList.contains("lucide-check"),
		).toBe(true);
	});

	it("highlights fenced code with the installed Codex Shiki themes", async () => {
		const { container } = render(
			<TooltipProvider>
				<MarkdownStream mode="static">{`\`\`\`tsx
const greeting = "hello";
export function Greeting() {
	return <strong>{greeting}</strong>;
}
\`\`\``}</MarkdownStream>
			</TooltipProvider>,
		);

		await waitFor(() => {
			const tokenStyles = Array.from(
				container.querySelectorAll<HTMLElement>(
					'[data-streamdown="code-block-body"] code span[style]',
				),
			);
			const lightColors = new Set(
				tokenStyles
					.map((token) => token.style.getPropertyValue("--sdm-c").toUpperCase())
					.filter(Boolean),
			);
			const darkColors = new Set(
				tokenStyles
					.map((token) =>
						token.style.getPropertyValue("--shiki-dark").toUpperCase(),
					)
					.filter(Boolean),
			);

			expect(lightColors).toContain("#D53538");
			expect(lightColors).toContain("#008809");
			expect(darkColors).toContain("#F67576");
			expect(darkColors).toContain("#85DF7B");
		});
	});

	it("keeps Markdown semantics without Streamdown typography classes", () => {
		const { container } = render(
			<MarkdownStream mode="static">{`# Title

## Section

First paragraph.

Second paragraph.

- First item
- Second item

> Quoted text

---`}</MarkdownStream>,
		);

		const root = container.querySelector<HTMLElement>(".graneri-markdown");
		expect(root).not.toBeNull();
		expect(root?.className).toContain("space-y-0");
		expect(root?.className).not.toContain("space-y-4");
		expect(screen.getByRole("heading", { level: 1 }).className).toBe("");
		expect(screen.getByRole("heading", { level: 2 }).className).toBe("");
		expect(screen.getByRole("list").className).toBe("");
		expect(screen.getAllByRole("listitem")[0]?.className).toBe("");
		expect(container.querySelector("blockquote")?.className).toBe("");
		expect(container.querySelector("hr")?.className).toBe("");
		expect(root?.querySelector(".text-3xl")).toBeNull();
	});
});
