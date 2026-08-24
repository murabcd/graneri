import { saveDesktopTextFile } from "@workspace/platform/desktop";
import { downloadBlobAsFile } from "@/lib/download-file";

export const exportTextFile = async ({
	fileName,
	content,
}: {
	fileName: string;
	content: string;
}) => {
	const desktopResult = await saveDesktopTextFile(fileName, content);

	if (desktopResult) {
		return desktopResult;
	}

	const blob = new Blob([content], {
		type: "text/plain;charset=utf-8",
	});
	downloadBlobAsFile({ blob, filename: fileName });

	return {
		ok: true,
		canceled: false,
		filePath: fileName,
	};
};
