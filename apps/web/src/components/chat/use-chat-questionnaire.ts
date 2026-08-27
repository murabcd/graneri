import type { HostedHumanDecisionResponse } from "@workspace/ai/hosted-human-decision";
import type {
	HostedUserQuestion,
	HostedUserQuestionPendingDecision,
} from "@workspace/ai/hosted-user-question";
import * as React from "react";
import { getQuestionOptionPresentation } from "@/components/chat/chat-questionnaire-option";

const SINGLE_SELECT_ADVANCE_MS = 180;

type QuestionnaireAnswer = {
	selectedOptionIndex: number | null;
	freeformText: string;
};

const isTextEntryTarget = (target: EventTarget | null) =>
	target instanceof Element &&
	Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

const createInitialAnswers = (
	questions: HostedUserQuestion[],
): QuestionnaireAnswer[] =>
	questions.map((question) => ({
		selectedOptionIndex: question.options.length > 0 ? 0 : null,
		freeformText: "",
	}));

const replaceAnswer = (
	answers: QuestionnaireAnswer[],
	index: number,
	answer: QuestionnaireAnswer,
) =>
	answers.map((current, currentIndex) =>
		currentIndex === index ? answer : current,
	);

const formatQuestionnaireAnswer = (
	questions: HostedUserQuestion[],
	answers: QuestionnaireAnswer[],
) =>
	questions
		.map((question, index) => {
			const answer = answers[index];
			const selectedOption =
				answer?.selectedOptionIndex === null ||
				answer?.selectedOptionIndex === undefined
					? null
					: question.options[answer.selectedOptionIndex];
			const value = answer?.freeformText.trim()
				? answer.freeformText.trim()
				: selectedOption
					? getQuestionOptionPresentation(selectedOption).label
					: "Skipped";
			return `> ${question.question}\n${value}`;
		})
		.join("\n\n");

export function useChatQuestionnaire({
	decision,
	disabled,
	onRespond,
}: {
	decision: HostedUserQuestionPendingDecision;
	disabled?: boolean;
	onRespond: (response: HostedHumanDecisionResponse) => void;
}) {
	const [questionIndex, setQuestionIndex] = React.useState(0);
	const [answers, setAnswers] = React.useState(() =>
		createInitialAnswers(decision.questions),
	);
	const [advancingOptionIndex, setAdvancingOptionIndex] = React.useState<
		number | null
	>(null);
	const advanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const question = decision.questions[questionIndex];
	const answer = answers[questionIndex];
	const isLastQuestion = questionIndex === decision.questions.length - 1;

	React.useEffect(() => {
		return () => {
			if (advanceTimerRef.current) {
				clearTimeout(advanceTimerRef.current);
			}
		};
	}, []);

	const advanceOrSubmit = React.useCallback(
		(nextAnswers: QuestionnaireAnswer[]) => {
			setAdvancingOptionIndex(null);
			if (!isLastQuestion) {
				setQuestionIndex((current) => current + 1);
				return;
			}
			onRespond({
				type: "user_question",
				answer: formatQuestionnaireAnswer(decision.questions, nextAnswers),
			});
		},
		[decision.questions, isLastQuestion, onRespond],
	);

	const selectOption = React.useCallback(
		(optionIndex: number) => {
			if (disabled || advancingOptionIndex !== null) {
				return;
			}
			const nextAnswers = replaceAnswer(answers, questionIndex, {
				selectedOptionIndex: optionIndex,
				freeformText: "",
			});
			setAnswers(nextAnswers);
			setAdvancingOptionIndex(optionIndex);
			advanceTimerRef.current = setTimeout(() => {
				advanceTimerRef.current = null;
				advanceOrSubmit(nextAnswers);
			}, SINGLE_SELECT_ADVANCE_MS);
		},
		[advanceOrSubmit, advancingOptionIndex, answers, disabled, questionIndex],
	);

	const submitFreeformAnswer = React.useCallback(() => {
		if (
			disabled ||
			advancingOptionIndex !== null ||
			!answer.freeformText.trim()
		) {
			return;
		}
		advanceOrSubmit(answers);
	}, [
		advanceOrSubmit,
		advancingOptionIndex,
		answer.freeformText,
		answers,
		disabled,
	]);

	const skipCurrentQuestion = React.useCallback(() => {
		if (disabled || advancingOptionIndex !== null) {
			return;
		}
		const nextAnswers = replaceAnswer(answers, questionIndex, {
			selectedOptionIndex: null,
			freeformText: "",
		});
		setAnswers(nextAnswers);
		advanceOrSubmit(nextAnswers);
	}, [advanceOrSubmit, advancingOptionIndex, answers, disabled, questionIndex]);

	const closeQuestionnaire = React.useCallback(() => {
		if (disabled || advancingOptionIndex !== null) {
			return;
		}
		onRespond({
			type: "user_question",
			answer: formatQuestionnaireAnswer(
				decision.questions,
				decision.questions.map(() => ({
					selectedOptionIndex: null,
					freeformText: "",
				})),
			),
		});
	}, [advancingOptionIndex, decision.questions, disabled, onRespond]);

	const setSelectedOption = React.useCallback(
		(optionIndex: number | null) => {
			setAnswers((current) =>
				replaceAnswer(current, questionIndex, {
					selectedOptionIndex: optionIndex,
					freeformText: "",
				}),
			);
		},
		[questionIndex],
	);

	const goToQuestion = React.useCallback((nextIndex: number) => {
		setAdvancingOptionIndex(null);
		setQuestionIndex(nextIndex);
	}, []);

	React.useEffect(() => {
		if (disabled) {
			return;
		}
		const handleShortcut = (event: KeyboardEvent) => {
			if (
				advancingOptionIndex !== null ||
				event.defaultPrevented ||
				event.isComposing ||
				event.repeat ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return;
			}

			if (
				!isTextEntryTarget(event.target) &&
				event.key >= "1" &&
				event.key <= "9"
			) {
				const optionIndex = Number(event.key) - 1;
				if (question.options[optionIndex]) {
					event.preventDefault();
					selectOption(optionIndex);
				}
				return;
			}
			if (isTextEntryTarget(event.target)) {
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				if (question.options.length === 0) {
					return;
				}
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				const selectedOptionIndex = answer.selectedOptionIndex ?? -1;
				const nextIndex = Math.min(
					Math.max(selectedOptionIndex + direction, 0),
					question.options.length - 1,
				);
				setSelectedOption(nextIndex);
				return;
			}
			if (event.key === "ArrowLeft" && questionIndex > 0) {
				event.preventDefault();
				goToQuestion(questionIndex - 1);
				return;
			}
			if (
				event.key === "ArrowRight" &&
				questionIndex < decision.questions.length - 1
			) {
				event.preventDefault();
				goToQuestion(questionIndex + 1);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				closeQuestionnaire();
				return;
			}
			if (event.key === "Enter" && answer.selectedOptionIndex !== null) {
				event.preventDefault();
				selectOption(answer.selectedOptionIndex);
			}
		};

		document.addEventListener("keydown", handleShortcut);
		return () => document.removeEventListener("keydown", handleShortcut);
	}, [
		advancingOptionIndex,
		answer.selectedOptionIndex,
		closeQuestionnaire,
		decision.questions.length,
		disabled,
		goToQuestion,
		question.options,
		questionIndex,
		selectOption,
		setSelectedOption,
	]);

	const updateFreeformText = (freeformText: string) => {
		setAnswers((current) =>
			replaceAnswer(current, questionIndex, {
				selectedOptionIndex: null,
				freeformText,
			}),
		);
	};

	return {
		advancingOptionIndex,
		answer,
		closeQuestionnaire,
		hasMultipleQuestions: decision.questions.length > 1,
		isFirstQuestion: questionIndex === 0,
		isLastQuestion,
		nextQuestion: () => goToQuestion(questionIndex + 1),
		previousQuestion: () => goToQuestion(questionIndex - 1),
		question,
		questionIndex,
		selectOption,
		setSelectedOption,
		skipCurrentQuestion,
		submitFreeformAnswer,
		updateFreeformText,
	};
}
