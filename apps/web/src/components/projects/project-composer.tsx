import { EntityNameComposer } from "@/components/entity-name-composer";

type ProjectComposerProps = {
	name: string;
	onNameChange: (value: string) => void;
	error?: string | null;
	nameInputId?: string;
	className?: string;
};

export function ProjectComposer({
	name,
	onNameChange,
	error = null,
	nameInputId = "project-name",
	className,
}: ProjectComposerProps) {
	return (
		<EntityNameComposer
			className={className}
			error={error}
			label="Project name"
			maxLength={48}
			name={name}
			nameInputId={nameInputId}
			onNameChange={onNameChange}
		/>
	);
}
