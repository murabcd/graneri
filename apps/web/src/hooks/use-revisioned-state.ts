import * as React from "react";

export type RevisionedStateSnapshot<Value> = {
	revision: number;
	value: Value;
};

export type RevisionedStateClaim<Value> = {
	claimedRevision: number;
	value: Value;
};

export const useRevisionedState = <Value>(initialValue: Value) => {
	const [value, setValueState] = React.useState(initialValue);
	const snapshotRef = React.useRef<RevisionedStateSnapshot<Value>>({
		revision: 0,
		value: initialValue,
	});

	const setValue = React.useCallback(
		(nextValue: React.SetStateAction<Value>) => {
			const resolvedValue =
				typeof nextValue === "function"
					? (nextValue as (currentValue: Value) => Value)(
							snapshotRef.current.value,
						)
					: nextValue;
			snapshotRef.current = {
				revision: snapshotRef.current.revision + 1,
				value: resolvedValue,
			};
			setValueState(resolvedValue);
		},
		[],
	);

	const getSnapshot = React.useCallback(() => snapshotRef.current, []);

	const claimSnapshot = React.useCallback(
		(snapshot: RevisionedStateSnapshot<Value>, replacement: Value) => {
			if (snapshotRef.current.revision !== snapshot.revision) {
				return null;
			}

			setValue(replacement);
			return {
				claimedRevision: snapshotRef.current.revision,
				value: snapshot.value,
			} satisfies RevisionedStateClaim<Value>;
		},
		[setValue],
	);

	const restoreClaim = React.useCallback(
		(claim: RevisionedStateClaim<Value>) => {
			if (snapshotRef.current.revision !== claim.claimedRevision) {
				return false;
			}

			setValue(claim.value);
			return true;
		},
		[setValue],
	);
	const isClaimCurrent = React.useCallback(
		(claim: RevisionedStateClaim<Value>) =>
			snapshotRef.current.revision === claim.claimedRevision,
		[],
	);

	return {
		claimSnapshot,
		getSnapshot,
		isClaimCurrent,
		restoreClaim,
		setValue,
		value,
	};
};
