import type { HostedChatTurnIntent } from "@workspace/ai/hosted-chat-runtime";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

type HostedAssistantRunIdentity = {
	_id: Id<"assistantRuns">;
	assistantMessageId: string;
};

export type QueuedTurnAcceptance =
	| {
			type: "replay";
			queuedMessageId: Id<"assistantQueuedMessages">;
			run: HostedAssistantRunIdentity;
	  }
	| {
			type: "steer";
			queuedMessageId: Id<"assistantQueuedMessages">;
			runId: Id<"assistantRuns">;
	  };

type QueuedMessageAcceptanceStatus = FunctionReturnType<
	typeof api.assistantQueuedMessageAcceptances.getAcceptanceStatus
>;

type ExpectedQueuedTurnAcceptanceReceipt = {
	assistantMessageId: string;
	claimVersion: number;
	messageId: string;
	producer: "convex" | "web";
	queuedMessageId: Id<"assistantQueuedMessages">;
} & ({ kind: "replay" } | { kind: "steer"; runId: Id<"assistantRuns"> });

export const createExpectedQueuedTurnAcceptanceReceipt = ({
	assistantMessageId,
	claimVersion,
	messageId,
	producer,
	queuedMessageId,
	turnIntent,
}: {
	assistantMessageId: string;
	claimVersion: number;
	messageId: string;
	producer: "convex" | "web";
	queuedMessageId: Id<"assistantQueuedMessages">;
	turnIntent: HostedChatTurnIntent<
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>;
}): ExpectedQueuedTurnAcceptanceReceipt => {
	if (turnIntent.type === "direct") {
		throw new Error(
			"Direct chat input cannot own a queued acceptance receipt.",
		);
	}
	const identity = {
		assistantMessageId,
		claimVersion,
		messageId,
		producer,
		queuedMessageId,
	};
	return turnIntent.type === "steer"
		? { ...identity, kind: "steer", runId: turnIntent.runId }
		: { ...identity, kind: "replay" };
};

const recoverQueuedTurnAcceptance = (
	status: Extract<QueuedMessageAcceptanceStatus, { status: "accepted" }>,
	expected: ExpectedQueuedTurnAcceptanceReceipt,
): QueuedTurnAcceptance | null => {
	const { receipt } = status;
	if (
		receipt.kind !== expected.kind ||
		receipt.queuedMessageId !== expected.queuedMessageId ||
		receipt.claimVersion !== expected.claimVersion ||
		receipt.messageId !== expected.messageId ||
		receipt.assistantMessageId !== expected.assistantMessageId ||
		receipt.producer !== expected.producer ||
		(expected.kind === "steer" && receipt.runId !== expected.runId)
	) {
		return null;
	}
	return receipt.kind === "steer"
		? {
				type: "steer",
				queuedMessageId: receipt.queuedMessageId,
				runId: receipt.runId,
			}
		: {
				type: "replay",
				queuedMessageId: receipt.queuedMessageId,
				run: {
					_id: receipt.runId,
					assistantMessageId: receipt.assistantMessageId,
				},
			};
};

export type PersistQueuedTurnAcceptanceFailure =
	| { type: "persist"; error: unknown }
	| { type: "status_lookup"; error: unknown }
	| { type: "release_failed" };

export const persistQueuedTurnAcceptance = async ({
	clearClaimed,
	expected,
	getAcceptanceStatus,
	persist,
	releaseClaimed,
}: {
	clearClaimed: () => void;
	expected: ExpectedQueuedTurnAcceptanceReceipt;
	getAcceptanceStatus: () => Promise<QueuedMessageAcceptanceStatus>;
	persist: () => Promise<QueuedTurnAcceptance>;
	releaseClaimed: () => Promise<boolean>;
}): Promise<
	| { ok: true; acceptance: QueuedTurnAcceptance }
	| { ok: false; failure: PersistQueuedTurnAcceptanceFailure }
> => {
	try {
		return { ok: true, acceptance: await persist() };
	} catch (error) {
		let status: QueuedMessageAcceptanceStatus;
		try {
			status = await getAcceptanceStatus();
		} catch (lookupError) {
			return {
				ok: false,
				failure: { type: "status_lookup", error: lookupError },
			};
		}
		if (status.status === "accepted") {
			const acceptance = recoverQueuedTurnAcceptance(status, expected);
			if (!acceptance) {
				return {
					ok: false,
					failure: {
						type: "status_lookup",
						error: new Error(
							"Queued message acceptance receipt does not match the attempted turn.",
						),
					},
				};
			}
			clearClaimed();
			return { ok: true, acceptance };
		}
		if (!(await releaseClaimed())) {
			return { ok: false, failure: { type: "release_failed" } };
		}
		return { ok: false, failure: { type: "persist", error } };
	}
};
