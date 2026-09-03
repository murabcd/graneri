import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { logError } from "@/lib/logger";
import {
	type SettingsImagePurpose,
	uploadSettingsImage,
} from "@/lib/settings-image-upload";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type PendingSettingsImage = {
	file: File;
	uploadId: Id<"settingsImageUploads">;
};

const useObjectUrlPreview = (file: File | null) => {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!file) {
			setPreviewUrl(null);
			return;
		}

		const nextPreviewUrl = URL.createObjectURL(file);
		setPreviewUrl(nextPreviewUrl);
		return () => URL.revokeObjectURL(nextPreviewUrl);
	}, [file]);

	return previewUrl;
};

export const useSettingsImageUpload = (purpose: SettingsImagePurpose) => {
	const discardUpload = useMutation(api.settingsImageUploads.discard);
	const discardUploadRef = useRef(discardUpload);
	useEffect(() => {
		discardUploadRef.current = discardUpload;
	}, [discardUpload]);
	const [pendingUpload, setPendingUpload] =
		useState<PendingSettingsImage | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const activeUploadCountRef = useRef(0);
	const isMountedRef = useRef(true);
	const pendingUploadRef = useRef<PendingSettingsImage | null>(null);
	const uploadRevisionRef = useRef(0);
	const previewUrl = useObjectUrlPreview(pendingUpload?.file ?? null);

	const discard = useCallback(async (upload: PendingSettingsImage) => {
		try {
			await discardUploadRef.current({ uploadId: upload.uploadId });
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to discard pending settings image",
			});
		}
	}, []);

	const clearPendingUpload = useCallback(async () => {
		uploadRevisionRef.current += 1;
		const currentUpload = pendingUploadRef.current;
		pendingUploadRef.current = null;
		setPendingUpload(null);
		if (currentUpload) {
			await discard(currentUpload);
		}
	}, [discard]);

	const markPendingUploadCommitted = useCallback(
		(uploadId: Id<"settingsImageUploads">) => {
			if (pendingUploadRef.current?.uploadId !== uploadId) {
				return;
			}
			uploadRevisionRef.current += 1;
			pendingUploadRef.current = null;
			setPendingUpload(null);
		},
		[],
	);

	const upload = useCallback(
		async (file: File) => {
			const uploadRevision = uploadRevisionRef.current + 1;
			uploadRevisionRef.current = uploadRevision;
			activeUploadCountRef.current += 1;
			setIsUploading(true);
			try {
				const nextUpload: PendingSettingsImage = {
					file,
					uploadId: await uploadSettingsImage({ file, purpose }),
				};
				if (
					!isMountedRef.current ||
					uploadRevision !== uploadRevisionRef.current
				) {
					await discard(nextUpload);
					return;
				}
				const previousUpload = pendingUploadRef.current;
				pendingUploadRef.current = nextUpload;
				setPendingUpload(nextUpload);
				if (previousUpload) {
					await discard(previousUpload);
				}
			} finally {
				activeUploadCountRef.current -= 1;
				if (isMountedRef.current) {
					setIsUploading(activeUploadCountRef.current > 0);
				}
			}
		},
		[discard, purpose],
	);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			uploadRevisionRef.current += 1;
			const currentUpload = pendingUploadRef.current;
			pendingUploadRef.current = null;
			if (currentUpload) {
				void discard(currentUpload);
			}
		};
	}, [discard]);

	return {
		clearPendingUpload,
		isUploading,
		markPendingUploadCommitted,
		pendingUpload,
		previewUrl,
		upload,
	};
};
