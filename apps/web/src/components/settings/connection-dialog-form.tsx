import { Button } from "@workspace/ui/components/button";
import { LoaderCircle } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

type ConnectionDialogFormProps = {
	children: ReactNode;
	onCancel: () => void;
	onConnect: () => void;
	isFormValid: boolean;
	isSaving: boolean;
};

export function ConnectionDialogForm({
	children,
	onCancel,
	onConnect,
	isFormValid,
	isSaving,
}: ConnectionDialogFormProps) {
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!isFormValid || isSaving) {
			return;
		}

		onConnect();
	};

	return (
		<form className="contents" onSubmit={handleSubmit}>
			{children}
			<div className="flex justify-end gap-2 pt-2">
				<Button
					type="button"
					variant="ghost"
					onClick={onCancel}
					disabled={isSaving}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={!isFormValid || isSaving}>
					{isSaving ? (
						<>
							<LoaderCircle className="animate-spin" />
							Connecting
						</>
					) : (
						"Connect"
					)}
				</Button>
			</div>
		</form>
	);
}
