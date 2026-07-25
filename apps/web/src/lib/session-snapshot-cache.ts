type SessionSnapshotCacheEntry = {
	cachedAt: number;
	key: string;
};

export const createSessionSnapshotCache = <
	Entry extends SessionSnapshotCacheEntry,
>({
	deserialize,
	maxEntries,
	serialize,
	storageKey,
}: {
	deserialize: (rawValue: string) => Entry[] | null;
	maxEntries: number;
	serialize: (entries: Entry[]) => string;
	storageKey: string;
}) => {
	const memoryCache = new Map<string, Entry>();
	let storageHydrated = false;

	const hydrate = () => {
		if (storageHydrated) {
			return;
		}

		storageHydrated = true;
		if (typeof window === "undefined") {
			return;
		}

		try {
			const rawValue = window.sessionStorage.getItem(storageKey);
			if (!rawValue) {
				return;
			}

			for (const entry of deserialize(rawValue) ?? []) {
				memoryCache.set(entry.key, entry);
			}
		} catch {
			// Invalid or unavailable session storage behaves like an empty cache.
		}
	};

	const persist = () => {
		const entries = Array.from(memoryCache.values())
			.sort((left, right) => right.cachedAt - left.cachedAt)
			.slice(0, maxEntries);

		memoryCache.clear();
		for (const entry of entries) {
			memoryCache.set(entry.key, entry);
		}

		if (typeof window === "undefined") {
			return;
		}

		try {
			window.sessionStorage.setItem(storageKey, serialize(entries));
		} catch {
			// The in-memory cache remains available for the current app session.
		}
	};

	return {
		delete: (key: string) => {
			hydrate();
			memoryCache.delete(key);
			persist();
		},
		get: (key: string) => {
			hydrate();
			return memoryCache.get(key) ?? null;
		},
		set: (entry: Entry) => {
			hydrate();
			memoryCache.set(entry.key, entry);
			persist();
		},
		values: () => {
			hydrate();
			return Array.from(memoryCache.values());
		},
	};
};
