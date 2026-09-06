import { MAX_LOCAL_FILE_SAVE_BYTES } from "@workspace/ai/local-folder-file-contract";
import { z } from "zod";

const uploadResultSchema = z.object({
	storageId: z.string().min(1),
});

const getConvexOrigin = () => {
	const convexUrl =
		process.env.CONVEX_URL?.trim() || process.env.VITE_CONVEX_URL?.trim();
	if (!convexUrl) {
		throw new Error("CONVEX_URL is not configured.");
	}
	return new URL(convexUrl).origin;
};

const requireConvexStorageUrl = (value) => {
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.origin !== getConvexOrigin() ||
		url.username ||
		url.password
	) {
		throw new Error("Local file transfer target is invalid.");
	}
	return url;
};

export const createLocalFileDownload =
	({ download, fetchImpl = fetch }) =>
	async (storageId) => {
		if (!download || download.storageId !== storageId)
			throw new Error("An authorized download for this file is required.");
		const url = requireConvexStorageUrl(download.url);
		const response = await fetchImpl(url, {
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok || !response.body)
			throw new Error("Local file download failed.");
		const chunks = [];
		let size = 0;
		for await (const chunk of response.body) {
			size += chunk.byteLength;
			if (size > MAX_LOCAL_FILE_SAVE_BYTES)
				throw new Error("File exceeds the 50 MB local save limit.");
			chunks.push(chunk);
		}
		return Buffer.concat(chunks, size);
	};

export const createLocalFileStore = ({ fetchImpl = fetch, uploadUrls }) => {
	const validatedUploadUrls = uploadUrls.map(requireConvexStorageUrl);
	let nextUploadIndex = 0;

	return async ({ bytes, mediaType }) => {
		const uploadUrl = validatedUploadUrls[nextUploadIndex];
		if (!uploadUrl) {
			throw new Error("Local file upload capacity is missing.");
		}
		nextUploadIndex += 1;

		const response = await fetchImpl(uploadUrl, {
			body: bytes,
			headers: { "Content-Type": mediaType },
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error("Local file upload failed.");
		}

		return uploadResultSchema.parse(await response.json());
	};
};
