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
} from "@workspace/ui/components/card";
import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "cn";
import {
	ChevronLeft,
	ChevronRight,
	MessageCircleQuestionMark,
	Pencil,
	X,
} from "lucide-react";
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
				"group/option h-auto min-h-8 w-full justify-start gap-2 rounded-xl px-1 py-0 text-left whitespace-normal",
				highlighted && "bg-muted",
			)}
		>
			<Kbd
				className={cn(
					"size-6 shrink-0 rounded-full border border-border bg-muted p-0",
					advancing && "border-foreground bg-primary text-primary-foreground",
				)}
			>
				{index + 1}
			</Kbd>
			<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 max-[440px]:flex-col max-[440px]:items-stretch">
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
	const cardRef = React.useRef<HTMLDivElement>(null);
	const selectedOptionIndex = answer.selectedOptionIndex;

	React.useEffect(() => {
		cardRef.current?.focus();
	}, []);

	return (
		<Card
			ref={cardRef}
			size="sm"
			className="mx-auto w-[calc(100%-1rem)] max-w-[548px] gap-0 rounded-lg py-0 shadow-lg outline-none data-[size=sm]:py-0"
			role="group"
			aria-label={question.question}
			tabIndex={0}
		>
			<CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 pt-3 pb-2 group-data-[size=sm]/card:px-3">
				<div className="flex min-w-0 items-center gap-3">
					<MessageCircleQuestionMark
						data-slot="question-status-icon"
						aria-hidden="true"
						className="size-[18px] shrink-0 text-blue-500"
					/>
					<span className="shrink-0 font-medium text-foreground">Question</span>
					<span className="min-w-0 text-muted-foreground">
						{question.question}
					</span>
				</div>
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
						aria-keyshortcuts="Escape"
					>
						<X aria-hidden="true" />
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent
				className="flex flex-col gap-1 px-2 pt-1 pb-2 group-data-[size=sm]/card:px-2"
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
						selected ||
						advancingOptionIndex === index ||
						(advancingOptionIndex === null && hoveredOptionIndex === index);

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
			<CardFooter className="gap-2 border-t-0 bg-transparent px-3 py-1.5 group-data-[size=sm]/card:px-3">
				<label
					className="flex min-h-8 min-w-0 flex-1 items-center gap-2"
					onPointerEnter={() => setHoveredOptionIndex(null)}
				>
					<span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
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
