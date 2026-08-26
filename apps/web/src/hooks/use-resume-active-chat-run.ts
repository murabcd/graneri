import * as React from "react";
import type { AttachableAssistantRun } from "@/lib/attachable-assistant-run";
import { logError } from "@/lib/logger";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ResumableActiveRun = Pick<
	AttachableAssistantRun,
	"_id" | "producer" | "status"
>;

const resumeRunPromises = new Map<string, Promise<void>>();

export const useResumeActiveChatRun = ({
	activeRun,
	chatId,
	enabled = true,
	resumeStream,
	workspaceId,
}: {
	activeRun: ResumableActiveRun | null | undefined;
	chatId: string;
	enabled?: boolean;
	resumeStream: () => Promise<void>;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const resumedRunKeyRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		const shouldResetResumeKey =
			!workspaceId ||
			!enabled ||
			activeRun?.status === "waiting_for_user" ||
			activeRun?.producer === "convex";

		if (shouldResetResumeKey || !activeRun) {
			if (shouldResetResumeKey) {
				resumedRunKeyRef.current = null;
			}
			return () => {
				cancelled = true;
			};
		}

		const runKey = `${workspaceId}:${chatId}:${activeRun._id}`;
		if (resumedRunKeyRef.current === runKey || resumeRunPromises.has(runKey)) {
			return () => {
				cancelled = true;
			};
		}

		resumedRunKeyRef.current = runKey;
		const resumePromise = resumeStream()
			.catch((error: unknown) => {
				if (!cancelled && resumedRunKeyRef.current === runKey) {
					resumedRunKeyRef.current = null;
				}
				logError({
					event: "client.error",
					error: error,
					message: "Failed to resume active chat run",
				});
			})
			.finally(() => {
				if (resumeRunPromises.get(runKey) === resumePromise) {
					resumeRunPromises.delete(runKey);
				}
			});
		resumeRunPromises.set(runKey, resumePromise);

		return () => {
			cancelled = true;
		};
	}, [activeRun, chatId, enabled, resumeStream, workspaceId]);
};
