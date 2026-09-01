import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { OpenAILogo } from "@workspace/ui/components/icons";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
	chatModels,
	type ReasoningEffort,
	reasoningEfforts,
	type ServiceTier,
	serviceTiers,
} from "@/lib/ai/models";

export type ChatModel = (typeof chatModels)[number];
export type { ReasoningEffort, ServiceTier };

const getSelectedModelDisplayName = (name: string) => name.replace(/^GPT-/, "");
const keepModelPickerOpen = (event: Event) => event.preventDefault();

type ChatModelPickerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedModel: ChatModel;
	onSelectedModelChange: (model: ChatModel) => void;
	triggerClassName?: string;
	triggerIconClassName?: string;
	modelNameClassName?: string;
	contentClassName?: string;
	menuLabel?: string;
	reasoningEffort?: ReasoningEffort;
	onReasoningEffortChange?: (value: ReasoningEffort) => void;
	serviceTier?: ServiceTier;
	onServiceTierChange?: (value: ServiceTier) => void;
};

export function ChatModelPicker({
	open,
	onOpenChange,
	selectedModel,
	onSelectedModelChange,
	triggerClassName,
	triggerIconClassName,
	modelNameClassName,
	contentClassName,
	menuLabel = "OpenAI",
	reasoningEffort,
	onReasoningEffortChange,
	serviceTier,
	onServiceTierChange,
}: ChatModelPickerProps) {
	const showReasoningEffort = Boolean(
		reasoningEffort && onReasoningEffortChange,
	);
	const selectedReasoningEffort = reasoningEfforts.find(
		(effort) => effort.id === reasoningEffort,
	);
	const showServiceTier = Boolean(serviceTier && onServiceTierChange);
	const selectedServiceTier = serviceTiers.find(
		(tier) => tier.id === serviceTier,
	);
	const showFastServiceTier = selectedServiceTier?.id === "priority";
	const selectedModelDisplayName = getSelectedModelDisplayName(
		selectedModel.name,
	);

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<InputGroupButton
							type="button"
							size="sm"
							className={cn(
								"group rounded-full gap-2 font-normal",
								triggerClassName,
							)}
							aria-label={`Model: ${selectedModelDisplayName}`}
						>
							<OpenAILogo
								className={cn(
									"size-3.5 text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground",
									triggerIconClassName,
								)}
							/>
							<span className={modelNameClassName}>
								{selectedModelDisplayName}
							</span>
							{showReasoningEffort ? (
								<span className="text-muted-foreground">
									{selectedReasoningEffort?.name}
								</span>
							) : null}
							{showFastServiceTier ? (
								<span className="text-muted-foreground">Fast</span>
							) : null}
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Select model</TooltipContent>
			</Tooltip>
			<DropdownMenuContent side="top" align="end" className={contentClassName}>
				<DropdownMenuGroup className={contentClassName ? undefined : "w-42"}>
					<DropdownMenuLabel className="text-muted-foreground text-xs">
						{menuLabel}
					</DropdownMenuLabel>
					{chatModels.map((model) => (
						<DropdownMenuCheckboxItem
							key={model.id}
							checked={model.id === selectedModel.id}
							onSelect={keepModelPickerOpen}
							onCheckedChange={(checked) => {
								if (checked) {
									onSelectedModelChange(model);
								}
							}}
							className="pl-2 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
						>
							<span className="inline-flex items-center gap-2">
								<OpenAILogo className="size-3.5 text-muted-foreground" />
								{model.name}
							</span>
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
				{showReasoningEffort || showServiceTier ? (
					<>
						<DropdownMenuSeparator />
						{showReasoningEffort ? (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<span>{selectedReasoningEffort?.name}</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="min-w-44">
									<DropdownMenuLabel className="text-muted-foreground text-xs">
										Effort
									</DropdownMenuLabel>
									<DropdownMenuRadioGroup
										value={reasoningEffort}
										onValueChange={(value) => {
											onReasoningEffortChange?.(value as ReasoningEffort);
										}}
									>
										{reasoningEfforts.map((effort) => (
											<DropdownMenuRadioItem
												key={effort.id}
												value={effort.id}
												onSelect={keepModelPickerOpen}
												className="pl-2 pr-8 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
											>
												{effort.name}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						) : null}
						{showServiceTier ? (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<span>{selectedServiceTier?.name}</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="min-w-44">
									<DropdownMenuLabel className="text-muted-foreground text-xs">
										Speed
									</DropdownMenuLabel>
									<DropdownMenuRadioGroup
										value={serviceTier}
										onValueChange={(value) => {
											onServiceTierChange?.(value as ServiceTier);
										}}
									>
										{serviceTiers.map((tier) => (
											<DropdownMenuRadioItem
												key={tier.id}
												value={tier.id}
												onSelect={keepModelPickerOpen}
												className="pl-2 pr-8 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
											>
												{tier.name}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						) : null}
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
