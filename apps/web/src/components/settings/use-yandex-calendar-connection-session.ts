import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessageWithoutTrailingPeriod as getToastErrorMessage } from "@/components/settings/connection-error-message";
import { initialYandexCalendarConnectionFormState } from "@/components/settings/connection-settings-state";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export function useYandexCalendarConnectionSession({
	activeWorkspaceId,
	defaultEmail,
	onConnected,
	yandexCalendarConnection,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	defaultEmail?: string | null;
	onConnected?: () => void | Promise<void>;
	yandexCalendarConnection?: { email?: string | null } | null;
}) {
	const connectYandexCalendar = useAction(
		api.appConnectionActions.connectYandexCalendar,
	);
	const [isYandexCalendarDialogOpen, setIsYandexCalendarDialogOpen] =
		useState(false);
	const [
		isSavingYandexCalendarConnection,
		setIsSavingYandexCalendarConnection,
	] = useState(false);
	const [yandexCalendarFormState, setYandexCalendarFormState] = useState(
		initialYandexCalendarConnectionFormState,
	);

	const handleYandexCalendarDialogOpenChange = (open: boolean) => {
		setIsYandexCalendarDialogOpen(() => open);

		if (open) {
			setYandexCalendarFormState({
				email: yandexCalendarConnection?.email ?? defaultEmail ?? "",
				password: "",
			});
			return;
		}

		setYandexCalendarFormState(initialYandexCalendarConnectionFormState);
	};

	const handleConnectYandexCalendar = async () => {
		if (
			!activeWorkspaceId ||
			!yandexCalendarFormState.email.trim() ||
			!yandexCalendarFormState.password.trim()
		) {
			return;
		}

		setIsSavingYandexCalendarConnection(true);

		try {
			await connectYandexCalendar({
				workspaceId: activeWorkspaceId,
				email: yandexCalendarFormState.email.trim(),
				password: yandexCalendarFormState.password.trim(),
			});
			await onConnected?.();
			toast.success("Yandex Calendar connected");
			handleYandexCalendarDialogOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to connect Yandex Calendar",
			});
			toast.error(
				getToastErrorMessage(error, "Failed to connect Yandex Calendar"),
			);
		} finally {
			setIsSavingYandexCalendarConnection(false);
		}
	};

	const isYandexCalendarFormValid =
		yandexCalendarFormState.email.trim().length > 0 &&
		yandexCalendarFormState.password.trim().length > 0;

	return {
		handleConnectYandexCalendar,
		handleYandexCalendarDialogOpenChange,
		isSavingYandexCalendarConnection,
		isYandexCalendarDialogOpen,
		isYandexCalendarFormValid,
		setYandexCalendarEmail: (email: string) =>
			setYandexCalendarFormState((currentState) => ({
				...currentState,
				email,
			})),
		setYandexCalendarPassword: (password: string) =>
			setYandexCalendarFormState((currentState) => ({
				...currentState,
				password,
			})),
		yandexCalendarFormState,
	};
}
