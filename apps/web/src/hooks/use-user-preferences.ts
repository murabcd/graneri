import { useMutation, useQuery } from "convex/react";
import { mergeUserPreferencesForOptimisticUpdate } from "@/lib/user-preferences";
import { api } from "../../../../convex/_generated/api";

export const useUserPreferences = () => {
	const userPreferences = useQuery(api.userPreferences.get, {});
	const updateUserPreferences = useMutation(
		api.userPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		const currentPreferences = localStore.getQuery(api.userPreferences.get, {});
		localStore.setQuery(
			api.userPreferences.get,
			{},
			mergeUserPreferencesForOptimisticUpdate(currentPreferences, args),
		);
	});

	return { updateUserPreferences, userPreferences };
};
