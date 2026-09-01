import { toHostedQueuedUserMessage } from "./hosted-chat-runtime.mjs";

export const createHostedChatQueuedInput = ({
	chatId,
	claimForReplay,
	claimForSteer,
	releaseClaimed,
	workspaceId,
}) => {
	let claimedLease = null;

	const clearClaimed = () => {
		claimedLease = null;
	};

	return {
		get hasClaimed() {
			return claimedLease !== null;
		},

		get claimedLease() {
			return claimedLease;
		},

		clearClaimed,

		async claimSteer({ queuedMessageId, runId }) {
			const claimedMessage = await claimForSteer({
				runId,
				queuedMessageId,
			});
			claimedLease = {
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
			};

			return {
				claimedMessage,
				userMessage: toHostedQueuedUserMessage(claimedMessage),
			};
		},

		async claimReplay({ expectedStatus, queuedMessageId }) {
			const attempt = await claimForReplay({
				workspaceId,
				chatId,
				expectedStatus,
				queuedMessageId,
			});
			if (attempt.status !== "claimed") {
				return attempt;
			}
			const { claimedMessage } = attempt;
			claimedLease = {
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
			};
			return {
				status: "claimed",
				userMessage: toHostedQueuedUserMessage(claimedMessage),
			};
		},

		async releaseClaimed() {
			const lease = claimedLease;
			if (!lease) {
				return { ok: true };
			}

			try {
				await releaseClaimed({
					workspaceId,
					chatId,
					queuedMessageId: lease.queuedMessageId,
					claimVersion: lease.claimVersion,
				});
				if (claimedLease === lease) {
					clearClaimed();
				}
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					error,
					queuedMessageId: lease.queuedMessageId,
				};
			}
		},
	};
};
