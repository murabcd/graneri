import { act, cleanup, render } from "@testing-library/react";
import type { DesktopAppCommand } from "@workspace/platform/desktop-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	useApplicationCommand,
	useDesktopApplicationCommands,
} from "@/lib/application-command";

let dispatchDesktopCommand: ((command: DesktopAppCommand) => void) | null =
	null;
const unsubscribe = vi.fn();

vi.mock("@workspace/platform/desktop", () => ({
	onDesktopAppCommand: vi.fn(
		(listener: (command: DesktopAppCommand) => void) => {
			dispatchDesktopCommand = listener;
			return unsubscribe;
		},
	),
}));

function ApplicationCommandHarness({ onGoHome }: { onGoHome: () => void }) {
	useDesktopApplicationCommands();
	useApplicationCommand("go-home", onGoHome);
	return null;
}

afterEach(() => {
	cleanup();
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
	dispatchDesktopCommand = null;
	unsubscribe.mockClear();
});

describe("application commands", () => {
	it("dispatches desktop commands to the React-owned action", () => {
		const onGoHome = vi.fn();
		render(<ApplicationCommandHarness onGoHome={onGoHome} />);

		act(() => dispatchDesktopCommand?.("go-home"));

		expect(onGoHome).toHaveBeenCalledOnce();
	});

	it("routes select all to the focused editable control", () => {
		const input = document.createElement("input");
		input.value = "Murad Abdulkadyrov";
		document.body.append(input);
		input.focus();
		input.setSelectionRange(2, 5);
		render(<ApplicationCommandHarness onGoHome={vi.fn()} />);

		act(() => dispatchDesktopCommand?.("select-all"));

		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
	});

	it("unsubscribes from the desktop bridge when the app unmounts", () => {
		const rendered = render(<ApplicationCommandHarness onGoHome={vi.fn()} />);

		rendered.unmount();

		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
