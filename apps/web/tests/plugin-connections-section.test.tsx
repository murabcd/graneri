import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginConnectionsSection } from "../src/components/settings/plugin-connections-section";

describe("plugin connection actions", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps uninstall in the installed plugin options menu", async () => {
		const user = userEvent.setup();
		const onUninstall = vi.fn();
		render(
			<PluginConnectionsSection
				connections={[
					{
						group: "Productivity",
						icon: <span aria-hidden="true" />,
						name: "Context7",
						installation: {
							status: "installed",
							provider: "context7",
							sourceId: "context7-source",
							onUninstall,
						},
						onConfigure: vi.fn(),
					},
				]}
				onTryNow={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("menuitem", { name: "Uninstall" })).toBeNull();
		await user.click(
			screen.getByRole("button", { name: "Options for Context7" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Uninstall" }));

		expect(onUninstall).toHaveBeenCalledOnce();
	});
});
