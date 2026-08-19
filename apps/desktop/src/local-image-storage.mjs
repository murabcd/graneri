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

const validateUploadUrls = (uploadUrls) => {
	if (uploadUrls.length === 0) {
		return [];
	}

	const convexOrigin = getConvexOrigin();
	return uploadUrls.map((value) => {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.origin !== convexOrigin) {
			throw new Error("Local image upload target is invalid.");
		}
		return url;
	});
};

export const createLocalImageStore = ({ fetchImpl = fetch, uploadUrls }) => {
	const validatedUploadUrls = validateUploadUrls(uploadUrls);
	let nextUploadIndex = 0;

	return async ({ bytes, mediaType }) => {
		const uploadUrl = validatedUploadUrls[nextUploadIndex];
		if (!uploadUrl) {
			throw new Error("Local image upload capacity is missing.");
		}
		nextUploadIndex += 1;

		const response = await fetchImpl(uploadUrl, {
			body: bytes,
			headers: { "Content-Type": mediaType },
			method: "POST",
		});
		if (!response.ok) {
			throw new Error("Local image upload failed.");
		}

		return uploadResultSchema.parse(await response.json());
	};
};
