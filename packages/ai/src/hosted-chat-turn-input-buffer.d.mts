export declare const HOSTED_TURN_INPUT_ACTIVITY_MAILBOX = "mailbox";
export declare const HOSTED_TURN_INPUT_ACTIVITY_STEER = "steer";
export type HostedTurnInputActivity =
	| typeof HOSTED_TURN_INPUT_ACTIVITY_MAILBOX
	| typeof HOSTED_TURN_INPUT_ACTIVITY_STEER;

export type HostedConsumedSteerInput = {
	input: unknown[];
	stepNumber: number;
};

export type HostedTurnInputBuffer = {
	acceptMailboxDeliveryForCurrentTurn(): void;
	clear(): void;
	deferMailboxDeliveryToNextTurn(): void;
	enqueueMailboxInput(input: unknown | readonly unknown[]): void;
	extendSteerInput(input: unknown | readonly unknown[]): void;
	hasPendingInput(): boolean;
	hasPendingMailboxInput(): boolean;
	subscribeActivity(listener: (activity: HostedTurnInputActivity) => void): {
		pendingActivity: HostedTurnInputActivity | null;
		unsubscribe(): void;
	};
	takeAllForReplacement(): unknown[];
	takeForReplacementByKind(): {
		acceptsMailboxDelivery: boolean;
		mailbox: unknown[];
		steer: unknown[];
	};
	takeForCurrentTurn(): unknown[];
	takeSteerInput(stepNumber: number): unknown[];
	takeSteerGenerationBoundary(): {
		consumed: HostedConsumedSteerInput[];
		pending: unknown[];
	};
};

export declare const createHostedTurnInputBuffer: () => HostedTurnInputBuffer;
