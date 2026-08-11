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
				isDisabling={false}
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
				isDisabling={false}
			>
				<label htmlFor="connection-name">Name</label>
				<Input id="connection-name" />
			</ConnectionDialogForm>,
		);

		await user.type(screen.getByRole("textbox", { name: "Name" }), "Docs");
		await user.keyboard("{Enter}");

		expect(onConnect).not.toHaveBeenCalled();
	});

	it("keeps a destructive action inactive until it is explicitly focused", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();

		render(
			<AlertDialog open>
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
			</AlertDialog>,
		);

		const cancel = screen.getByRole("button", { name: "Cancel" });
		const confirm = screen.getByRole("button", { name: "Delete" });
		await waitFor(() => expect(document.activeElement).toBe(cancel));

		await user.keyboard("{Enter}");
		expect(onConfirm).not.toHaveBeenCalled();

		confirm.focus();
		await user.keyboard("{Enter}");
		expect(onConfirm).toHaveBeenCalledOnce();
	});
});
