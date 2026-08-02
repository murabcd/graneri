import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const authStoreFileMode = 0o600;
const authStoreDirMode = 0o700;
const authStoreFileName = "desktop-auth-cookies.json";

const cookieEntrySchema = z.strictObject({
	expires: z.string().nullable(),
	value: z.string(),
});
const cookieJarSchema = z.record(z.string().min(1), cookieEntrySchema);
const cookieJarsSchema = z.record(z.string().min(1), cookieJarSchema);
const cookieStoreSchema = z.strictObject({ cookieJars: cookieJarsSchema });

export const parseCookieJars = (value) => {
	const result = cookieJarsSchema.safeParse(value);
	if (!result.success) {
		throw new Error("Desktop auth cookie jars are invalid.", {
			cause: result.error,
		});
	}
	return result.data;
};

const readStoreFile = (filePath) => {
	if (!existsSync(filePath)) {
		return {};
	}

	const result = cookieStoreSchema.safeParse(
		JSON.parse(readFileSync(filePath, "utf8")),
	);
	if (!result.success) {
		throw new Error("Desktop auth cookie store must contain cookieJars.");
	}
	return result.data.cookieJars;
};

const writeStoreFile = (filePath, cookieJars) => {
	mkdirSync(dirname(filePath), {
		recursive: true,
		mode: authStoreDirMode,
	});

	const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(
		tempFilePath,
		`${JSON.stringify({ cookieJars: parseCookieJars(cookieJars) }, null, 2)}\n`,
		{ mode: authStoreFileMode },
	);
	chmodSync(tempFilePath, authStoreFileMode);
	renameSync(tempFilePath, filePath);
	chmodSync(filePath, authStoreFileMode);
};

export const createDesktopAuthCookieStore = ({ userDataPath }) => {
	const filePath = join(userDataPath, authStoreFileName);

	return {
		readCookieJars: () => readStoreFile(filePath),
		writeCookieJars: (cookieJars) => writeStoreFile(filePath, cookieJars),
	};
};
