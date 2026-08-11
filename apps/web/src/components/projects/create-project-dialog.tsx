import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { LoaderCircle } from "lucide-react";
import { ProjectComposer } from "./project-composer";

type CreateProjectDialogProps = {
	error: string | null;
	isCreating: boolean;
	name: string;
	onNameChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: () => void;
	open: boolean;
};

export function CreateProjectDialog({
	error,
	isCreating,
	name,
	onNameChange,
	onOpenChange,
	onSubmit,
	open,
}: CreateProjectDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create a project</DialogTitle>
					<DialogDescription>
						Projects group notes in the sidebar without changing what a note is.
					</DialogDescription>
				</DialogHeader>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit();
					}}
				>
					<ProjectComposer
						name={name}
						onNameChange={onNameChange}
						error={error}
						nameInputId="project-dialog-name"
					/>
					<div className="flex items-center justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={isCreating || name.trim().length < 1}
						>
							{isCreating ? (
								<LoaderCircle
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : null}
							Create
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
