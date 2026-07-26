import type { ServiceTier } from "@/lib/ai/models";
import { DEFAULT_SERVICE_TIER, findServiceTier } from "@/lib/ai/models";

export type { ServiceTier };

const SERVICE_TIER_STORAGE_KEY = "graneri:chat-service-tier";

export const getStoredServiceTier = (): ServiceTier => {
	if (typeof window === "undefined") {
		return DEFAULT_SERVICE_TIER;
	}

	return getStoredServiceTierOverride() ?? DEFAULT_SERVICE_TIER;
};

export const getStoredServiceTierOverride = (): ServiceTier | null => {
	if (typeof window === "undefined") {
		return null;
	}

	return (
		findServiceTier(window.localStorage.getItem(SERVICE_TIER_STORAGE_KEY))
			?.id ?? null
	);
};

export const storeServiceTier = (value: ServiceTier) => {
	window.localStorage.setItem(SERVICE_TIER_STORAGE_KEY, value);
};
