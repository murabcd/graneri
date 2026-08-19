import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { GenericId } from "convex/values";

export declare const MAX_LOCAL_IMAGE_UPLOADS: number;

export declare const getLocalImageUploadCount: (args: {
	input: unknown;
	toolName: string;
}) => number;

export declare const resolveLocalImageToolOutput: (args: {
	input: unknown;
	output: unknown;
	resolveStorageUrl: (
		storageId: GenericId<"_storage">,
	) => Promise<string | null>;
	toolName: string;
}) => Promise<unknown>;

export declare const readLocalFileOutputForModel: (args: {
	input: unknown;
	output: unknown;
}) => ToolResultOutput;

export declare const searchLocalFilesOutputForModel: (args: {
	input: unknown;
	output: unknown;
}) => ToolResultOutput;
