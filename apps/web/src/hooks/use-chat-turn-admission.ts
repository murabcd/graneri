import * as React from "react";
import type { AttachableAssistantRun } from "@/lib/attachable-assistant-run";

export type ChatTurnAdmission =
	| { status: "canceled" }
	| { status: "direct" }
	| {
			beginDirectSubmission: () => void;
			completeQueuedAdmission: () => void;
			status: "current_run";
	  };

type LocalSubmissionBoundary = {
	promise: Promise<SubmissionBoundaryOutcome>;
	release: (outcome: SubmissionBoundaryOutcome) => void;
};

type SubmissionBoundaryOutcome = "active_run" | "no_active" | "queued";

const NO_ACTIVE_SUBMISSION_BOUNDARY =
	Promise.resolve<SubmissionBoundaryOutcome>("no_active");

const createLocalSubmissionBoundary = (): LocalSubmissionBoundary => {
	let isReleased = false;
	let resolveBoundary!: (outcome: SubmissionBoundaryOutcome) => void;
	const promise = new Promise<SubmissionBoundaryOutcome>((resolve) => {
		resolveBoundary = resolve;
	});
	const release = (outcome: SubmissionBoundaryOutcome) => {
		if (isReleased) {
			return;
		}
		isReleased = true;
		resolveBoundary(outcome);
	};

	return { promise, release };
};

export const useChatTurnAdmission = ({
	isAiRequestPending,
	queueActiveRun,
	scopeKey,
}: {
	isAiRequestPending: boolean;
	queueActiveRun: AttachableAssistantRun | null;
	scopeKey: string;
}) => {
	const scopeKeyRef = React.useRef(scopeKey);
	const scopeVersionRef = React.useRef(0);
	const unobservedDirectSubmissionRef =
		React.useRef<LocalSubmissionBoundary | null>(null);
	const pendingAdmissionBoundaryRef =
		React.useRef<LocalSubmissionBoundary | null>(null);
	const admissionBoundariesRef = React.useRef(
		new Set<LocalSubmissionBoundary>(),
	);
	const admissionTailRef = React.useRef(NO_ACTIVE_SUBMISSION_BOUNDARY);
	React.useLayoutEffect(() => {
		if (scopeKeyRef.current === scopeKey) {
			return;
		}

		for (const boundary of admissionBoundariesRef.current) {
			boundary.release("no_active");
		}
		admissionBoundariesRef.current.clear();
		unobservedDirectSubmissionRef.current = null;
		pendingAdmissionBoundaryRef.current = null;
		admissionTailRef.current = NO_ACTIVE_SUBMISSION_BOUNDARY;
		scopeKeyRef.current = scopeKey;
		scopeVersionRef.current += 1;
	}, [scopeKey]);

	const settleAdmissionBoundary = React.useCallback(
		(boundary: LocalSubmissionBoundary, outcome: SubmissionBoundaryOutcome) => {
			boundary.release(outcome);
			admissionBoundariesRef.current.delete(boundary);
			if (pendingAdmissionBoundaryRef.current === boundary) {
				pendingAdmissionBoundaryRef.current = null;
			}
		},
		[],
	);
	const discardAdmissionBoundary = React.useCallback(
		(boundary: LocalSubmissionBoundary, outcome: SubmissionBoundaryOutcome) => {
			settleAdmissionBoundary(boundary, outcome);
			if (unobservedDirectSubmissionRef.current === boundary) {
				unobservedDirectSubmissionRef.current = null;
			}
		},
		[settleAdmissionBoundary],
	);
	const completeAdmissionBoundary = React.useCallback(
		(boundary: LocalSubmissionBoundary) => {
			settleAdmissionBoundary(
				boundary,
				unobservedDirectSubmissionRef.current === boundary
					? "active_run"
					: "no_active",
			);
		},
		[settleAdmissionBoundary],
	);

	React.useEffect(() => {
		const boundary = unobservedDirectSubmissionRef.current;
		if (queueActiveRun && boundary) {
			discardAdmissionBoundary(boundary, "active_run");
		}
	}, [discardAdmissionBoundary, queueActiveRun]);

	React.useEffect(
		() => () => {
			scopeVersionRef.current += 1;
			for (const boundary of admissionBoundariesRef.current) {
				boundary.release("no_active");
			}
			admissionBoundariesRef.current.clear();
			unobservedDirectSubmissionRef.current = null;
			pendingAdmissionBoundaryRef.current = null;
		},
		[],
	);

	const runTurnAdmission = React.useCallback(
		<Result>(operation: (admission: ChatTurnAdmission) => Promise<Result>) => {
			const operationScopeVersion = scopeVersionRef.current;
			const unobservedDirectSubmission = unobservedDirectSubmissionRef.current;
			const pendingAdmissionBoundary = pendingAdmissionBoundaryRef.current;
			if (
				queueActiveRun ||
				isAiRequestPending ||
				unobservedDirectSubmission ||
				pendingAdmissionBoundary
			) {
				const predecessorBoundary = admissionTailRef.current;
				const boundary = createLocalSubmissionBoundary();
				admissionBoundariesRef.current.add(boundary);
				admissionTailRef.current = boundary.promise;
				pendingAdmissionBoundaryRef.current = boundary;
				const predecessorOwnsPendingRequest = Boolean(
					unobservedDirectSubmission || pendingAdmissionBoundary,
				);
				const result = predecessorBoundary.then((predecessorOutcome) => {
					if (scopeVersionRef.current !== operationScopeVersion) {
						return operation({ status: "canceled" });
					}
					if (
						!queueActiveRun &&
						predecessorOutcome === "no_active" &&
						(predecessorOwnsPendingRequest || !isAiRequestPending)
					) {
						unobservedDirectSubmissionRef.current = boundary;
						return operation({ status: "direct" });
					}
					return operation({
						beginDirectSubmission: () => {
							if (scopeVersionRef.current === operationScopeVersion) {
								unobservedDirectSubmissionRef.current = boundary;
							}
						},
						completeQueuedAdmission: () =>
							discardAdmissionBoundary(boundary, "queued"),
						status: "current_run",
					});
				});
				void result.then(
					() => completeAdmissionBoundary(boundary),
					() => discardAdmissionBoundary(boundary, "no_active"),
				);
				return result;
			}

			const boundary = createLocalSubmissionBoundary();
			admissionBoundariesRef.current.add(boundary);
			unobservedDirectSubmissionRef.current = boundary;
			pendingAdmissionBoundaryRef.current = boundary;
			admissionTailRef.current = boundary.promise;
			const result = Promise.resolve().then(() =>
				operation(
					scopeVersionRef.current === operationScopeVersion
						? { status: "direct" }
						: { status: "canceled" },
				),
			);
			void result.then(
				() => completeAdmissionBoundary(boundary),
				() => discardAdmissionBoundary(boundary, "no_active"),
			);
			return result;
		},
		[
			completeAdmissionBoundary,
			discardAdmissionBoundary,
			isAiRequestPending,
			queueActiveRun,
		],
	);

	return { runTurnAdmission };
};
