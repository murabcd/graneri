import { PROJECT_DESCRIPTION_MAX_LENGTH } from "@workspace/ai/project-description-contract";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Textarea } from "@workspace/ui/components/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { LoaderCircle, Zap } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import { optimisticUpdateProjectList } from "@/lib/optimistic-projects";
import { requestGeneratedProjectDescription } from "@/lib/project-description-generation";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";

export function ProjectDescriptionEditor({
	project,
}: {
	project: Doc<"projects">;
}) {
	const [description, setDescription] = React.useReducer(
		(_current: string, next: string) => next,
		project.description,
	);
	const [isGenerating, setIsGenerating] = React.useState(false);
	const descriptionContext = useQuery(api.projectDescriptions.getContext, {
		workspaceId: project.workspaceId,
		projectId: project._id,
	});
	const hasDescription = description.trim().length > 0;
	const canGenerate =
		descriptionContext !== undefined &&
		(hasDescription || descriptionContext.length > 0);
	const updateDescription = useMutation(
		api.projects.updateDescription,
	).withOptimisticUpdate((localStore, args) => {
		optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
			projects.map((entry) =>
				entry._id === args.id
					? {
							...entry,
							description: args.description,
							updatedAt: Date.now(),
						}
					: entry,
			),
		);
	});

	const handleDescriptionChange = React.useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			setDescription(event.target.value);
		},
		[],
	);

	const handleDescriptionBlur = React.useCallback(() => {
		if (description === project.description) {
			return;
		}

		void updateDescription({
			workspaceId: project.workspaceId,
			id: project._id,
			description,
		}).catch((error) => {
			logError({
				event: "client.error",
				error,
				message: "Failed to update project description",
			});
			setDescription(project.description);
		});
	}, [description, project, updateDescription]);

	const handleGenerateDescription = React.useCallback(async () => {
		if (isGenerating || descriptionContext === undefined || !canGenerate) {
			return;
		}

		const previousDescription = description;
		setIsGenerating(true);
		try {
			const generatedDescription = await requestGeneratedProjectDescription({
				currentDescription: description,
				notes: descriptionContext,
				projectName: project.name,
			});
			setDescription(generatedDescription);
			await updateDescription({
				workspaceId: project.workspaceId,
				id: project._id,
				description: generatedDescription,
			});
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to generate project description",
			});
			setDescription(previousDescription);
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to generate project description",
			);
		} finally {
			setIsGenerating(false);
		}
	}, [
		canGenerate,
		description,
		descriptionContext,
		isGenerating,
		project,
		updateDescription,
	]);

	const descriptionActionLabel = hasDescription
		? "Regenerate project description"
		: "Generate project description";

	return (
		<Card className="max-w-full overflow-hidden rounded-lg border-border py-0 shadow-sm">
			<CardContent className="grid min-h-[84px] min-w-0 p-3">
				<div className="relative min-w-0">
					<Textarea
						name="project-description"
						value={description}
						maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
						placeholder="Add a description..."
						aria-label="Project description"
						aria-busy={isGenerating}
						readOnly={isGenerating}
						rows={1}
						className="min-h-0 max-w-full resize-none wrap-anywhere rounded-none border-0 bg-transparent p-0 pr-8 shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
						onBlur={handleDescriptionBlur}
						onChange={handleDescriptionChange}
					/>
					<Tooltip>
						<TooltipTrigger asChild>
							<span
								className={cn(
									"absolute right-0 bottom-0 inline-flex",
									canGenerate ? "cursor-pointer" : "cursor-not-allowed",
								)}
							>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="text-muted-foreground hover:text-foreground"
									aria-label={descriptionActionLabel}
									disabled={isGenerating || !canGenerate}
									onPointerDown={(event) => event.preventDefault()}
									onClick={handleGenerateDescription}
								>
									{isGenerating ? (
										<LoaderCircle className="animate-spin" />
									) : (
										<Zap />
									)}
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent side="bottom" align="center" sideOffset={8}>
							Generate
						</TooltipContent>
					</Tooltip>
				</div>
			</CardContent>
		</Card>
	);
}
