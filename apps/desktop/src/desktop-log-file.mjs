import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";

const ignoreMissingFile = (error) => {
	if (error?.code !== "ENOENT") {
		throw error;
	}
};

const rotateLogFiles = async ({ filePath, retainedFiles }) => {
	await rm(`${filePath}.${retainedFiles}`, { force: true });
	for (let index = retainedFiles - 1; index >= 1; index -= 1) {
		await rename(`${filePath}.${index}`, `${filePath}.${index + 1}`).catch(
			ignoreMissingFile,
		);
	}
	await rename(filePath, `${filePath}.1`).catch(ignoreMissingFile);
};

const closeOutput = async (output) => {
	output.end();
	await finished(output);
};

const writeOutput = async (output, chunk) => {
	await new Promise((resolve, reject) => {
		output.write(chunk, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
};

export const createRotatingLogFileStream = ({
	filePath,
	maxBytes,
	retainedFiles,
}) => {
	mkdirSync(dirname(filePath), { recursive: true });
	let bytesWritten = 0;
	try {
		bytesWritten = statSync(filePath).size;
	} catch (error) {
		ignoreMissingFile(error);
	}
	let output = createWriteStream(filePath, { flags: "a" });

	return new Writable({
		final(callback) {
			void closeOutput(output).then(
				() => callback(),
				(error) => callback(error),
			);
		},
		write(chunk, encoding, callback) {
			const buffer = Buffer.isBuffer(chunk)
				? chunk
				: Buffer.from(chunk, encoding);

			void (async () => {
				if (bytesWritten > 0 && bytesWritten + buffer.length > maxBytes) {
					await closeOutput(output);
					await rotateLogFiles({ filePath, retainedFiles });
					output = createWriteStream(filePath, { flags: "a" });
					bytesWritten = 0;
				}

				await writeOutput(output, buffer);
				bytesWritten += buffer.length;
			})().then(
				() => callback(),
				(error) => callback(error),
			);
		},
	});
};
