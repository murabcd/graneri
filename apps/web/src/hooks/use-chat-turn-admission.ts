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
	const localSubmissionBoundaryRef =
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
		localSubmissionBoundaryRef.current = null;
		pendingAdmissionBoundaryRef.current = null;
		admissionTailRef.current = NO_ACTIVE_SUBMISSION_BOUNDARY;
		scopeKeyRef.current = scopeKey;
		scopeVersionRef.current += 1;
	}, [scopeKey]);

	const releaseLocalSubmissionBoundary = React.useCallback(
		(boundary: LocalSubmissionBoundary, outcome: SubmissionBoundaryOutcome) => {
			boundary.release(outcome);
			admissionBoundariesRef.current.delete(boundary);
			if (localSubmissionBoundaryRef.current === boundary) {
				localSubmissionBoundaryRef.current = null;
			}
			if (pendingAdmissionBoundaryRef.current === boundary) {
				pendingAdmissionBoundaryRef.current = null;
			}
		},
		[],
	);

	React.useEffect(() => {
		const boundary = localSubmissionBoundaryRef.current;
		if (queueActiveRun && boundary) {
			releaseLocalSubmissionBoundary(boundary, "active_run");
		}
	}, [queueActiveRun, releaseLocalSubmissionBoundary]);

	React.useEffect(
		() => () => {
			scopeVersionRef.current += 1;
			for (const boundary of admissionBoundariesRef.current) {
				boundary.release("no_active");
			}
			admissionBoundariesRef.current.clear();
			localSubmissionBoundaryRef.current = null;
			pendingAdmissionBoundaryRef.current = null;
		},
		[],
	);

	const runTurnAdmission = React.useCallback(
		<Result>(operation: (admission: ChatTurnAdmission) => Promise<Result>) => {
			const operationScopeVersion = scopeVersionRef.current;
			const localSubmissionBoundary = localSubmissionBoundaryRef.current;
			const pendingAdmissionBoundary = pendingAdmissionBoundaryRef.current;
			if (
				queueActiveRun ||
				isAiRequestPending ||
				localSubmissionBoundary ||
				pendingAdmissionBoundary
			) {
				const predecessorBoundary = admissionTailRef.current;
				const boundary = createLocalSubmissionBoundary();
				admissionBoundariesRef.current.add(boundary);
				admissionTailRef.current = boundary.promise;
				pendingAdmissionBoundaryRef.current = boundary;
				const predecessorOwnsPendingRequest = Boolean(
					localSubmissionBoundary || pendingAdmissionBoundary,
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
						localSubmissionBoundaryRef.current = boundary;
						return operation({ status: "direct" });
					}
					return operation({
						beginDirectSubmission: () => {
							if (scopeVersionRef.current === operationScopeVersion) {
								localSubmissionBoundaryRef.current = boundary;
							}
						},
						completeQueuedAdmission: () =>
							releaseLocalSubmissionBoundary(boundary, "queued"),
						status: "current_run",
					});
				});
				void result.then(
					() => releaseLocalSubmissionBoundary(boundary, "no_active"),
					() => releaseLocalSubmissionBoundary(boundary, "no_active"),
				);
				return result;
			}

			const boundary = createLocalSubmissionBoundary();
			admissionBoundariesRef.current.add(boundary);
			localSubmissionBoundaryRef.current = boundary;
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
				() => releaseLocalSubmissionBoundary(boundary, "no_active"),
				() => releaseLocalSubmissionBoundary(boundary, "no_active"),
			);
			return result;
		},
		[isAiRequestPending, queueActiveRun, releaseLocalSubmissionBoundary],
	);

	return { runTurnAdmission };
};
