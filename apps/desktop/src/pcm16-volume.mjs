export const getPcm16BufferAverageAbsVolume = (pcm16) => {
	const sampleCount = Math.floor(pcm16.byteLength / 2);
	if (sampleCount === 0) {
		return 0;
	}

	let sum = 0;
	for (let offset = 0; offset < sampleCount * 2; offset += 2) {
		sum += Math.abs(pcm16.readInt16LE(offset)) / 32768;
	}
	return sum / sampleCount;
};

export const getBase64Pcm16AverageAbsVolume = (base64Pcm16) =>
	base64Pcm16
		? getPcm16BufferAverageAbsVolume(Buffer.from(base64Pcm16, "base64"))
		: 0;
