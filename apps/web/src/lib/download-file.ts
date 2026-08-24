const DOWNLOADABLE_PROTOCOLS = new Set(["blob:", "data:", "http:", "https:"]);

export const isDownloadableUrl = (url: string): boolean => {
	try {
		return DOWNLOADABLE_PROTOCOLS.has(
			new URL(url, "https://graneri.local").protocol,
		);
	} catch {
		return false;
	}
};

export const downloadBlobAsFile = ({
	blob,
	filename,
}: {
	blob: Blob;
	filename: string;
}): void => {
	const objectUrl = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement("a");
		anchor.download = filename;
		anchor.href = objectUrl;
		anchor.click();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
};

export const downloadUrlAsFile = async ({
	filename,
	url,
}: {
	filename: string;
	url: string;
}): Promise<void> => {
	if (!isDownloadableUrl(url)) {
		throw new Error("File download URL is invalid.");
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`File download failed with status ${response.status}.`);
	}

	downloadBlobAsFile({ blob: await response.blob(), filename });
};
