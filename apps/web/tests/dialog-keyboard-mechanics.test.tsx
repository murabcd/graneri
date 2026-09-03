import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Input } from "@workspace/ui/components/input";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionDialogForm } from "../src/components/settings/connection-dialog-form";

function ConfirmationDialog({
	onConfirm,
	onOpenChange,
}: {
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<AlertDialog open onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete item?</AlertDialogTitle>
					<AlertDialogDescription>
						This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

describe("dialog keyboard mechanics", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("submits a valid connection form with Enter", async () => {
		const user = userEvent.setup();
		const onConnect = vi.fn();

		render(
			<ConnectionDialogForm
				onCancel={vi.fn()}
				onConnect={onConnect}
				isFormValid
				isSaving={false}
			>
				<label htmlFor="connection-name">Name</label>
				<Input id="connection-name" />
			</ConnectionDialogForm>,
		);

		await user.type(screen.getByRole("textbox", { name: "Name" }), "Docs");
		await user.keyboard("{Enter}");

		expect(onConnect).toHaveBeenCalledOnce();
	});

	it("does not submit an invalid connection form with Enter", async () => {
		const user = userEvent.setup();
		const onConnect = vi.fn();

		render(
			<ConnectionDialogForm
				onCancel={vi.fn()}
				onConnect={onConnect}
				isFormValid={false}
				isSaving={false}
			>
				<label htmlFor="connection-name">Name</label>
				<Input id="connection-name" />
			</ConnectionDialogForm>,
		);

		await user.type(screen.getByRole("textbox", { name: "Name" }), "Docs");
		await user.keyboard("{Enter}");

		expect(onConnect).not.toHaveBeenCalled();
	});

	it("confirms a destructive action with Enter", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();

		render(
			<ConfirmationDialog onConfirm={onConfirm} onOpenChange={onOpenChange} />,
		);

		const confirm = screen.getByRole("button", { name: "Delete" });
		await waitFor(() => expect(document.activeElement).toBe(confirm));

		await user.keyboard("{Enter}");
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("cancels a destructive action with Escape", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();

		render(
			<ConfirmationDialog onConfirm={onConfirm} onOpenChange={onOpenChange} />,
		);

		const confirm = screen.getByRole("button", { name: "Delete" });
		await waitFor(() => expect(document.activeElement).toBe(confirm));

		await user.keyboard("{Escape}");
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
