import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@workspace/ui/components/command";
import {
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Check, FolderClosed, X } from "lucide-react";
import * as React from "react";
import { ActiveComposerOption } from "@/components/ai-elements/active-composer-option";
import { HoverScrollTitle } from "@/components/hover-scroll-title";
import { ProjectIcon } from "@/components/projects/project-appearance-picker";
import type { Doc } from "../../../../../convex/_generated/dataModel";

export type ComposerProjectOption = Pick<
	Doc<"projects">,
	"_id" | "color" | "icon" | "name"
>;

type ComposerProjectPickerProps = {
	onSelectedProjectChange: (project: ComposerProjectOption | null) => void;
	projects: ComposerProjectOption[];
	projectsStatus: "loading" | "ready";
	selectedProject: ComposerProjectOption | null;
};

export function ActiveComposerProjectOption({
	onRemove,
	project,
}: {
	onRemove: () => void;
	project: ComposerProjectOption;
}) {
	return (
		<ActiveComposerOption
			disableLabel={`Remove ${project.name}`}
			icon={
				<ProjectIcon
					icon={project.icon}
					color={project.color}
					aria-hidden="true"
				/>
			}
			label={
				<HoverScrollTitle className="max-w-28" scrollOnHover={false}>
					{project.name}
				</HoverScrollTitle>
			}
			labelClassName="min-w-0"
			onDisable={onRemove}
		/>
	);
}

export function ComposerProjectPicker({
	onSelectedProjectChange,
	projects,
	projectsStatus,
	selectedProject,
}: ComposerProjectPickerProps) {
	const [open, setOpen] = React.useState(false);
	const [searchValue, setSearchValue] = React.useState("");
	const searchInputRef = React.useRef<HTMLInputElement>(null);

	const handleOpenChange = React.useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setSearchValue("");
		}
	}, []);

	React.useEffect(() => {
		if (!open) {
			return;
		}

		const focusFrame = requestAnimationFrame(() => {
			searchInputRef.current?.focus();
		});
		return () => cancelAnimationFrame(focusFrame);
	}, [open]);

	const selectProject = React.useCallback(
		(project: ComposerProjectOption | null) => {
			onSelectedProjectChange(project);
			handleOpenChange(false);
		},
		[handleOpenChange, onSelectedProjectChange],
	);

	return (
		<DropdownMenuSub open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuSubTrigger>
				{selectedProject ? (
					<ProjectIcon
						icon={selectedProject.icon}
						color={selectedProject.color}
						aria-hidden="true"
					/>
				) : (
					<FolderClosed aria-hidden="true" className="text-foreground" />
				)}
				<span>{selectedProject ? "Change project" : "Choose project"}</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuPortal>
				<DropdownMenuSubContent className="w-64 border-input/30 p-0">
					<Command>
						<CommandInput
							ref={searchInputRef}
							placeholder="Search projects"
							className="h-9"
							value={searchValue}
							onValueChange={setSearchValue}
						/>
						<CommandList className="max-h-60">
							<CommandEmpty>
								{projectsStatus === "loading"
									? "Loading projects…"
									: "No projects found."}
							</CommandEmpty>
							{projects.length > 0 ? (
								<CommandGroup
									heading="Projects"
									className="p-1 **:[[cmdk-group-heading]]:py-1"
								>
									{projects.map((project) => (
										<CommandItem
											key={project._id}
											value={`${project._id} ${project.name}`}
											className="relative w-full cursor-pointer gap-2 py-1.5 pr-8"
											onSelect={() => selectProject(project)}
										>
											<ProjectIcon
												icon={project.icon}
												color={project.color}
												aria-hidden="true"
											/>
											<span className="min-w-0 truncate">{project.name}</span>
											{selectedProject?._id === project._id ? (
												<span className="absolute right-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
													<Check aria-hidden="true" className="size-4" />
												</span>
											) : null}
										</CommandItem>
									))}
								</CommandGroup>
							) : null}
							{selectedProject ? (
								<>
									<CommandSeparator />
									<CommandGroup className="p-1">
										<CommandItem
											value="no project"
											className="cursor-pointer"
											onSelect={() => selectProject(null)}
										>
											<X aria-hidden="true" />
											<span>No project</span>
										</CommandItem>
									</CommandGroup>
								</>
							) : null}
						</CommandList>
					</Command>
				</DropdownMenuSubContent>
			</DropdownMenuPortal>
		</DropdownMenuSub>
	);
}
