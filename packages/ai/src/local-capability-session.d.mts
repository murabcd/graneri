export type LocalCapabilitySession = {
	id: string;
	label: string;
};

export declare const parseLocalCapabilitySession: (
	value: unknown,
) => LocalCapabilitySession | null;
