import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { useDropdownPopoverHandoff } from "@/hooks/use-dropdown-popover-handoff";
import { logError } from "@/lib/logger";
import { optimisticUpdateProjectIdentity } from "@/lib/optimistic-projects";
import {
	getProjectNameValidationError,
	normalizeProjectName,
} from "@/lib/project-name";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { ProjectAppearance } from "./project-appearance-picker";

type ProjectIdentityDraft = ProjectAppearance & {
	name: string;
};

export type ProjectIdentityEditorController = {
	cancel: () => void;
	commit: () => Promise<void>;
	completeMenuClose: () => void;
	draft: ProjectIdentityDraft;
	inputRef: React.RefObject<HTMLInputElement | null>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	preventMenuCloseAutoFocusRef: React.MutableRefObject<boolean>;
	previewAppearance: ProjectAppearance;
	setAppearance: (appearance: ProjectAppearance) => void;
	setName: (name: string) => void;
	start: () => void;
};

const toProjectIdentityDraft = (
	project: Pick<Doc<"projects">, "color" | "icon" | "name">,
): ProjectIdentityDraft => ({
	color: project.color,
	icon: project.icon,
	name: project.name,
});

export function useProjectIdentityEditor({
	project,
	workspaceId,
}: {
	project: Doc<"projects">;
	workspaceId: Id<"workspaces"> | null;
}): ProjectIdentityEditorController {
	const [open, setOpen] = React.useState(false);
	const [draft, setDraft] = React.useState<ProjectIdentityDraft>(() =>
		toProjectIdentityDraft(project),
	);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const isSavingRef = React.useRef(false);
	const openEditor = React.useCallback((value: ProjectIdentityDraft) => {
		setDraft(value);
		setOpen(true);
	}, []);
	const {
		completePopoverOpen: completeMenuClose,
		preparePopoverOpen,
		preventCloseAutoFocusRef: preventMenuCloseAutoFocusRef,
	} = useDropdownPopoverHandoff(openEditor);
	const updateProjectIdentity = useMutation(
		api.projects.updateIdentity,
	).withOptimisticUpdate((localStore, args) => {
		optimisticUpdateProjectIdentity({
			localStore,
			workspaceId: args.workspaceId,
			projectId: args.id,
			name: args.name,
			icon: args.icon,
			color: args.color,
		});
	});

	const cancel = React.useCallback(() => {
		setDraft(toProjectIdentityDraft(project));
		setOpen(false);
	}, [project]);

	const commit = React.useCallback(async () => {
		if (!workspaceId || isSavingRef.current) {
			return;
		}

		const name = normalizeProjectName(draft.name);
		const validationError = getProjectNameValidationError(name);
		if (validationError) {
			toast.error(validationError);
			return;
		}

		if (
			name === project.name &&
			draft.icon === project.icon &&
			draft.color === project.color
		) {
			setDraft({ ...draft, name });
			setOpen(false);
			return;
		}

		isSavingRef.current = true;
		try {
			await updateProjectIdentity({
				workspaceId,
				id: project._id,
				name,
				icon: draft.icon,
				color: draft.color,
			});
			setDraft({ ...draft, name });
			setOpen(false);
			toast.success("Project updated");
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to rename project",
			});
			toast.error("Failed to rename project");
		} finally {
			isSavingRef.current = false;
		}
	}, [draft, project, updateProjectIdentity, workspaceId]);

	const onOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				setOpen(true);
				return;
			}

			void commit();
		},
		[commit],
	);

	const setAppearance = React.useCallback((appearance: ProjectAppearance) => {
		setDraft((current) => ({ ...current, ...appearance }));
	}, []);
	const setName = React.useCallback((name: string) => {
		setDraft((current) => ({ ...current, name }));
	}, []);
	const start = React.useCallback(() => {
		preparePopoverOpen(toProjectIdentityDraft(project));
	}, [preparePopoverOpen, project]);

	return {
		cancel,
		commit,
		completeMenuClose,
		draft,
		inputRef,
		onOpenChange,
		open,
		preventMenuCloseAutoFocusRef,
		previewAppearance: {
			color: open ? draft.color : project.color,
			icon: open ? draft.icon : project.icon,
		},
		setAppearance,
		setName,
		start,
	};
}
