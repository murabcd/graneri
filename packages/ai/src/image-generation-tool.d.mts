import type { Tool, UIMessage } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type { ArtifactSource } from "./artifact-authoring-contract.mjs";

export type ChatAttachmentsApi = {
	generateUploadUrl: FunctionReference<
		"mutation",
		"public",
		Record<string, never>,
		string
	>;
	getUrl: FunctionReference<
		"mutation",
		"public",
		{ storageId: GenericId<"_storage"> },
		string | null
	>;
	getOwnedUrl: FunctionReference<
		"mutation",
		"public",
		{
			workspaceId: GenericId<"workspaces">;
			chatId: string;
			storageId: GenericId<"_storage">;
		},
		string | null
	>;
};

type ConvexGeneratedImageUploaderArgs = {
	chatAttachmentsApi: ChatAttachmentsApi;
	client: ConvexHttpClient;
};

type GeneratedImageArtifact = {
	filename: string;
	mediaType: string;
	providerMetadata: {
		graneri: {
			generatedBy: "ai";
			storageId: string;
		};
	};
	sizeBytes: number;
	url: string;
};

export declare const buildImageGenerationInstruction: () => string;

export declare const shouldEnableImageGeneration: (
	message: UIMessage | undefined,
) => boolean;

export declare const createConvexGeneratedImageUploader: (
	args: ConvexGeneratedImageUploaderArgs,
) => (image: Uint8Array) => Promise<GeneratedImageArtifact>;

export declare const createConvexSourceImageResolver: (args: {
	chatAttachmentsApi: ChatAttachmentsApi;
	chatId: string;
	client: ConvexHttpClient;
	workspaceId: GenericId<"workspaces">;
}) => (source: ArtifactSource) => Promise<Uint8Array>;

export declare const downloadSourceImage: (args: {
	source: ArtifactSource;
	url: string;
}) => Promise<Uint8Array>;

export declare const parseImageGenerationInput: (value: unknown) =>
	| { operation: "create"; prompt: string }
	| {
			operation: "edit";
			prompt: string;
			sources: ArtifactSource[];
			mask?: ArtifactSource;
	  };

export declare const createImageGenerationTool: (args: {
	resolveSourceImage: (source: ArtifactSource) => Promise<Uint8Array>;
	uploadGeneratedImage: (image: Uint8Array) => Promise<GeneratedImageArtifact>;
}) => Tool;
