import { EntityNameComposer } from "@/components/entity-name-composer";

type WorkspaceComposerProps = {
	name: string;
	onNameChange: (value: string) => void;
	error?: string | null;
	nameInputId?: string;
	className?: string;
};

export function WorkspaceComposer({
	name,
	onNameChange,
	error = null,
	nameInputId = "workspace-name",
	className,
}: WorkspaceComposerProps) {
	return (
		<EntityNameComposer
			className={className}
			error={error}
			label="Workspace name"
			maxLength={48}
			name={name}
			nameInputId={nameInputId}
			onNameChange={onNameChange}
		/>
	);
}
