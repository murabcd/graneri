import { Button } from "@workspace/ui/components/button";
import { LoaderCircle } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

type ConnectionDialogFormProps = {
	children: ReactNode;
	destructiveAction?: {
		label: string;
		onClick: () => void;
		pendingLabel: string;
	};
	onCancel: () => void;
	onConnect: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
};

export function ConnectionDialogForm({
	children,
	destructiveAction,
	onCancel,
	onConnect,
	isFormValid,
	isSaving,
	isDisabling,
}: ConnectionDialogFormProps) {
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!isFormValid || isSaving || isDisabling) {
			return;
		}

		onConnect();
	};

	return (
		<form className="contents" onSubmit={handleSubmit}>
			{children}
			<div className="flex items-center justify-between gap-2 pt-2">
				{destructiveAction ? (
					<Button
						type="button"
						variant="destructive"
						onClick={destructiveAction.onClick}
						disabled={isSaving || isDisabling}
					>
						{isDisabling ? (
							<>
								<LoaderCircle className="animate-spin" />
								{destructiveAction.pendingLabel}
							</>
						) : (
							destructiveAction.label
						)}
					</Button>
				) : (
					<span />
				)}
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={onCancel}
						disabled={isSaving || isDisabling}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={!isFormValid || isSaving || isDisabling}
					>
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
			</div>
		</form>
	);
}
