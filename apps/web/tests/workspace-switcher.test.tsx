import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { WorkspaceSwitcher } from "../src/components/workspaces/workspace-switcher";
import type { WorkspaceRecord } from "../src/lib/workspaces";

const workspaceId = "workspace-1" as Id<"workspaces">;
const createdWorkspaceId = "workspace-2" as Id<"workspaces">;
const workspace = {
	_id: workspaceId,
	_creationTime: 0,
	ownerTokenIdentifier: "owner-1",
	name: "Graneri",
	normalizedName: "graneri",
	createdAt: 0,
	updatedAt: 0,
	iconStorageId: null,
	iconUrl: null,
} satisfies WorkspaceRecord;
const createdWorkspace = {
	...workspace,
	_id: createdWorkspaceId,
	name: "Product",
	normalizedName: "product",
} satisfies WorkspaceRecord;

describe("WorkspaceSwitcher", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("creates a workspace when Enter is pressed in the name field", async () => {
		const user = userEvent.setup();
		const onCreateWorkspace = vi.fn().mockResolvedValue(createdWorkspace);
		const onSelect = vi.fn();

		render(
			<SidebarProvider>
				<WorkspaceSwitcher
					workspaces={[workspace]}
					activeWorkspaceId={workspaceId}
					onSelect={onSelect}
					onCreateWorkspace={onCreateWorkspace}
				/>
			</SidebarProvider>,
		);

		await user.click(screen.getByRole("button", { name: /Graneri/u }));
		await user.click(screen.getByRole("menuitem", { name: "Add workspace" }));
		await user.type(
			screen.getByRole("textbox", { name: "Workspace name" }),
			"Product{Enter}",
		);

		await waitFor(() =>
			expect(onCreateWorkspace).toHaveBeenCalledWith({ name: "Product" }),
		);
		expect(onSelect).toHaveBeenCalledWith(createdWorkspaceId);
	});
});
