import type { HostedHumanDecisionResponse } from "@workspace/ai/hosted-human-decision";
import type {
	HostedUserQuestionOption,
	HostedUserQuestionPendingDecision,
} from "@workspace/ai/hosted-user-question";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import * as React from "react";
import { getQuestionOptionPresentation } from "@/components/chat/chat-questionnaire-option";
import { useChatQuestionnaire } from "@/components/chat/use-chat-questionnaire";

const OTHER_ANSWER_PLACEHOLDER = "Something else...";

function QuestionOption({
	advancing,
	disabled,
	highlighted,
	index,
	onFocus,
	onPointerEnter,
	onSelect,
	option,
	selected,
}: {
	advancing: boolean;
	disabled?: boolean;
	highlighted: boolean;
	index: number;
	onFocus: () => void;
	onPointerEnter: () => void;
	onSelect: () => void;
	option: HostedUserQuestionOption;
	selected: boolean;
}) {
	const presentation = getQuestionOptionPresentation(option);

	return (
		<Button
			type="button"
			variant="ghost"
			role="radio"
			disabled={disabled || advancing}
			onClick={onSelect}
			onFocus={onFocus}
			onPointerEnter={onPointerEnter}
			aria-keyshortcuts={String(index + 1)}
			aria-checked={selected}
			className={cn(
				"group/option min-h-8 w-full justify-start gap-2 rounded-xl px-2 py-1.5 text-left whitespace-normal",
				highlighted && "bg-muted",
			)}
		>
			<Kbd
				className={cn(
					"size-7 shrink-0 self-start rounded-full border border-border bg-muted p-0",
					advancing && "border-foreground bg-primary text-primary-foreground",
				)}
			>
				{advancing ? (
					<span
						aria-hidden="true"
						className="size-1.5 rounded-full bg-current"
					/>
				) : (
					index + 1
				)}
			</Kbd>
			<span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 max-[440px]:flex-col max-[440px]:items-stretch">
				<span className="inline-flex min-w-0 items-center gap-1.5">
					<span className="min-w-0 text-sm font-medium break-words text-foreground">
						{presentation.label}
					</span>
					{presentation.recommended ? (
						<Badge
							variant="secondary"
							className="h-auto shrink-0 px-1.5 py-0.5"
						>
							Recommended
						</Badge>
					) : null}
				</span>
				<span className="min-w-0 text-sm font-normal break-words text-muted-foreground">
					{presentation.description}
				</span>
			</span>
			<ArrowRight
				data-icon="inline-end"
				aria-hidden="true"
				className={cn(
					"opacity-0 transition-opacity group-hover/option:opacity-100 group-focus-visible/option:opacity-100",
					highlighted && "opacity-100",
				)}
			/>
		</Button>
	);
}

export function ChatQuestionnaire({
	decision,
	disabled,
	onRespond,
}: {
	decision: HostedUserQuestionPendingDecision;
	disabled?: boolean;
	onRespond: (response: HostedHumanDecisionResponse) => void;
}) {
	const {
		advancingOptionIndex,
		answer,
		closeQuestionnaire,
		hasMultipleQuestions,
		isFirstQuestion,
		isLastQuestion,
		nextQuestion,
		previousQuestion,
		question,
		questionIndex,
		selectOption,
		setSelectedOption,
		skipCurrentQuestion,
		submitFreeformAnswer,
		updateFreeformText,
	} = useChatQuestionnaire({
		decision,
		disabled,
		onRespond,
	});
	const advancing = advancingOptionIndex !== null;
	const [hoveredOptionIndex, setHoveredOptionIndex] = React.useState<
		number | null
	>(null);
	const selectedOptionIndex = answer.selectedOptionIndex;

	return (
		<Card
			size="sm"
			className="mx-auto w-[calc(100%-1rem)] max-w-[548px] gap-0 rounded-lg py-0 shadow-lg"
			role="group"
			aria-label={question.question}
		>
			<CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pt-4 pr-3 pb-2 pl-4">
				<CardTitle>{question.question}</CardTitle>
				<CardAction className="flex items-center gap-0.5">
					{hasMultipleQuestions ? (
						<>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								disabled={disabled || advancing || isFirstQuestion}
								onClick={previousQuestion}
								aria-label="Previous question"
							>
								<ChevronLeft aria-hidden="true" />
							</Button>
							<span className="min-w-10 text-center text-xs font-medium text-muted-foreground tabular-nums">
								{questionIndex + 1} of {decision.questions.length}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								disabled={disabled || advancing || isLastQuestion}
								onClick={nextQuestion}
								aria-label="Next question"
							>
								<ChevronRight aria-hidden="true" />
							</Button>
						</>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						disabled={disabled || advancing}
						onClick={closeQuestionnaire}
						aria-label="Close questions"
					>
						<X aria-hidden="true" />
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent
				className="flex flex-col gap-1 px-2 pt-1 pb-2"
				role="radiogroup"
				aria-label={question.question}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) {
						setHoveredOptionIndex(null);
					}
				}}
				onPointerLeave={() => setHoveredOptionIndex(null)}
			>
				{question.options.map((option, index) => {
					const selected = selectedOptionIndex === index;
					const highlighted =
						advancingOptionIndex === index ||
						(advancingOptionIndex === null &&
							(hoveredOptionIndex === null
								? selected
								: hoveredOptionIndex === index));

					return (
						<QuestionOption
							key={option.label}
							advancing={advancingOptionIndex === index}
							disabled={disabled || advancing}
							highlighted={highlighted}
							index={index}
							onFocus={() => setHoveredOptionIndex(index)}
							onPointerEnter={() => setHoveredOptionIndex(index)}
							onSelect={() => selectOption(index)}
							option={option}
							selected={selected}
						/>
					);
				})}
			</CardContent>
			<CardFooter className="gap-2 border-t-0 bg-transparent px-2 py-1.5">
				<label
					className="flex min-h-8 min-w-0 flex-1 items-center gap-2"
					onPointerEnter={() => setHoveredOptionIndex(null)}
				>
					<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
						<Pencil aria-hidden="true" className="size-3.5" />
					</span>
					<input
						type="text"
						value={answer.freeformText}
						disabled={disabled || advancing}
						onChange={(event) => updateFreeformText(event.target.value)}
						onFocus={() => {
							setHoveredOptionIndex(null);
							if (!answer.freeformText) {
								setSelectedOption(null);
							}
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) {
								event.preventDefault();
								submitFreeformAnswer();
							}
						}}
						placeholder={OTHER_ANSWER_PLACEHOLDER}
						aria-label="Other answer"
						className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
				</label>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled || advancing}
					onClick={skipCurrentQuestion}
					className="rounded-full"
				>
					Skip
				</Button>
			</CardFooter>
		</Card>
	);
}
