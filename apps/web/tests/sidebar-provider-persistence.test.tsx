import { act, cleanup, render, renderHook } from "@testing-library/react";
import {
	SidebarProvider,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

function persistSidebarState(open: boolean) {
	const view = renderHook(useSidebarShell, { wrapper: SidebarProvider });
	act(() => view.result.current.setOpen(open));
	view.unmount();
}

function SidebarStateRecorder({
	states,
}: {
	states: Array<"expanded" | "collapsed">;
}) {
	const { state } = useSidebarShell();
	useLayoutEffect(() => {
		states.push(state);
	}, [state, states]);
	return null;
}

describe("SidebarProvider persistence", () => {
	afterEach(() => {
		cleanup();
	});

	it.each([
		{ defaultOpen: true, persistedOpen: false, state: "collapsed" },
		{ defaultOpen: false, persistedOpen: true, state: "expanded" },
	] as const)("starts $state without rendering the opposite state after a refresh", ({
		defaultOpen,
		persistedOpen,
		state,
	}) => {
		persistSidebarState(persistedOpen);
		const states: Array<"expanded" | "collapsed"> = [];

		render(
			<SidebarProvider defaultOpen={defaultOpen}>
				<SidebarStateRecorder states={states} />
			</SidebarProvider>,
		);

		expect(states).not.toHaveLength(0);
		expect(states.every((observedState) => observedState === state)).toBe(true);
	});
});
