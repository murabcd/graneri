import * as React from "react";
import {
	clearComposerDraft,
	loadComposerDraft,
	storeComposerDraft,
} from "@/lib/composer-draft";

export type ComposerDraftSnapshot<TMetadata> = {
	text: string;
	metadata: TMetadata | null;
	revision: number;
};

export type ComposerDraftClaim<TMetadata> = {
	claimedRevision: number;
	draft: ComposerDraftSnapshot<TMetadata>;
};

type ComposerDraftValue<TMetadata> = Omit<
	ComposerDraftSnapshot<TMetadata>,
	"revision"
>;

const emptyComposerDraft = <TMetadata>(): ComposerDraftValue<TMetadata> => ({
	text: "",
	metadata: null,
});

const readComposerDraft = <TMetadata>(
	scopeKey: string | null,
	initialDraft: ComposerDraftValue<TMetadata> | null,
	revision: number,
): ComposerDraftSnapshot<TMetadata> => ({
	...(scopeKey
		? (loadComposerDraft<TMetadata>(scopeKey) ??
			initialDraft ??
			emptyComposerDraft())
		: (initialDraft ?? emptyComposerDraft())),
	revision,
});

export const useComposerDraft = <TMetadata>(
	scopeKey: string | null,
	initialDraft: ComposerDraftValue<TMetadata> | null = null,
): {
	text: string;
	metadata: TMetadata | null;
	setText: (value: React.SetStateAction<string>) => void;
	setMetadata: (value: TMetadata | null) => void;
	getSnapshot: () => ComposerDraftSnapshot<TMetadata>;
	claimSnapshot: (
		snapshot: ComposerDraftSnapshot<TMetadata>,
	) => ComposerDraftClaim<TMetadata> | null;
	isClaimCurrent: (claim: ComposerDraftClaim<TMetadata>) => boolean;
	restoreClaim: (claim: ComposerDraftClaim<TMetadata>) => boolean;
	clear: () => void;
} => {
	const [draft, setDraftState] = React.useState(() =>
		readComposerDraft<TMetadata>(scopeKey, initialDraft, 0),
	);
	const draftRef = React.useRef(draft);
	const scopeKeyRef = React.useRef(scopeKey);
	if (scopeKeyRef.current !== scopeKey) {
		draftRef.current = {
			...draftRef.current,
			revision: draftRef.current.revision + 1,
		};
		scopeKeyRef.current = scopeKey;
	}
	const persistTimeoutRef = React.useRef<number | null>(null);

	const cancelPendingPersist = React.useCallback(() => {
		if (persistTimeoutRef.current === null) {
			return;
		}

		window.clearTimeout(persistTimeoutRef.current);
		persistTimeoutRef.current = null;
	}, []);

	const persistNow = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			if (!scopeKey) {
				return;
			}

			storeComposerDraft(scopeKey, nextDraft.text, nextDraft.metadata);
		},
		[scopeKey],
	);

	React.useEffect(() => {
		cancelPendingPersist();
		const nextDraft = readComposerDraft<TMetadata>(
			scopeKey,
			initialDraft,
			draftRef.current.revision + 1,
		);
		draftRef.current = nextDraft;
		// Draft state hydrates from scope-keyed localStorage when the active composer changes.
		setDraftState(nextDraft);
	}, [cancelPendingPersist, initialDraft, scopeKey]);

	const persist = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			if (!scopeKey) {
				return;
			}

			cancelPendingPersist();
			persistTimeoutRef.current = window.setTimeout(() => {
				persistTimeoutRef.current = null;
				persistNow(nextDraft);
			}, 200);
		},
		[cancelPendingPersist, persistNow, scopeKey],
	);

	const setDraft = React.useCallback(
		(nextDraftValue: ComposerDraftValue<TMetadata>) => {
			const nextDraft = {
				...nextDraftValue,
				revision: draftRef.current.revision + 1,
			};
			draftRef.current = nextDraft;
			React.startTransition(() => {
				setDraftState(() => nextDraft);
			});
			persist(nextDraft);
		},
		[persist],
	);

	const setText = React.useCallback(
		(value: React.SetStateAction<string>) => {
			const nextText =
				typeof value === "function" ? value(draftRef.current.text) : value;
			setDraft({
				...draftRef.current,
				text: nextText,
			});
		},
		[setDraft],
	);

	const setMetadata = React.useCallback(
		(value: TMetadata | null) => {
			setDraft({
				...draftRef.current,
				metadata: value,
			});
		},
		[setDraft],
	);

	const getSnapshot = React.useCallback(() => draftRef.current, []);

	const clear = React.useCallback(() => {
		const nextDraft = {
			...emptyComposerDraft<TMetadata>(),
			revision: draftRef.current.revision + 1,
		};
		cancelPendingPersist();
		draftRef.current = nextDraft;
		setDraftState(nextDraft);
		if (scopeKey) {
			clearComposerDraft(scopeKey);
		}
	}, [cancelPendingPersist, scopeKey]);

	const claimSnapshot = React.useCallback(
		(snapshot: ComposerDraftSnapshot<TMetadata>) => {
			if (draftRef.current.revision !== snapshot.revision) {
				return null;
			}

			clear();
			return {
				claimedRevision: draftRef.current.revision,
				draft: snapshot,
			};
		},
		[clear],
	);

	const restoreClaim = React.useCallback(
		(claim: ComposerDraftClaim<TMetadata>) => {
			if (draftRef.current.revision !== claim.claimedRevision) {
				return false;
			}

			setDraft({
				metadata: claim.draft.metadata,
				text: claim.draft.text,
			});
			return true;
		},
		[setDraft],
	);
	const isClaimCurrent = React.useCallback(
		(claim: ComposerDraftClaim<TMetadata>) =>
			draftRef.current.revision === claim.claimedRevision,
		[],
	);

	React.useEffect(() => {
		return () => {
			if (persistTimeoutRef.current === null || !scopeKey) {
				return;
			}

			cancelPendingPersist();
			persistNow(draftRef.current);
		};
	}, [cancelPendingPersist, persistNow, scopeKey]);

	return {
		text: draft.text,
		metadata: draft.metadata,
		setText,
		setMetadata,
		getSnapshot,
		claimSnapshot,
		isClaimCurrent,
		restoreClaim,
		clear,
	};
};
