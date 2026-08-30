import { z } from "zod";

export const localCapabilitySessionSchema = z.strictObject({
	id: z.string().trim().min(1).max(128),
	label: z.string().trim().min(1).max(256),
});

export const parseLocalCapabilitySession = (value) => {
	const result = localCapabilitySessionSchema.safeParse(value);
	return result.success ? result.data : null;
};
