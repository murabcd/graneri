import AVFoundation
import Dispatch
import Foundation

final class CombinedAudioProcessingPipeline: @unchecked Sendable {
	struct SelfTestResult {
		let echoOnlyResidualRatio: Double
		let echoReductionRatio: Double
		let noRenderPassthroughErrorRms: Double
		let processedErrorRms: Double
		let rawErrorRms: Double
		let suppressedChunks: Int
		let systemOutputErrorRms: Double

		var isPassing: Bool {
			echoOnlyResidualRatio <= 0.45 &&
				echoReductionRatio >= 0.35 &&
				noRenderPassthroughErrorRms <= 0.000001 &&
				suppressedChunks > 0 &&
				systemOutputErrorRms <= 0.000001
		}

		func asEvent() -> [String: Any] {
			[
				"echoOnlyResidualRatio": echoOnlyResidualRatio,
				"echoReductionRatio": echoReductionRatio,
				"noRenderPassthroughErrorRms": noRenderPassthroughErrorRms,
				"ok": isPassing,
				"processedErrorRms": processedErrorRms,
				"rawErrorRms": rawErrorRms,
				"suppressedChunks": suppressedChunks,
				"systemOutputErrorRms": systemOutputErrorRms,
				"type": "self_test",
			]
		}
	}

	private final class SourceSink: NativeAudioPcmSink, @unchecked Sendable {
		private let appendBuffer: @Sendable (AVAudioPCMBuffer, UInt64) -> Void

		init(appendBuffer: @escaping @Sendable (AVAudioPCMBuffer, UInt64) -> Void) {
			self.appendBuffer = appendBuffer
		}

		func append(buffer: AVAudioPCMBuffer, hostTime: UInt64) {
			appendBuffer(buffer, hostTime)
		}
	}

	private struct SourceStats {
		var chunks = 0
		var frames = 0
		var lastRms: Double = 0
		var lastObservedAt: DispatchTime?
		var maxRms: Double = 0
		var nonSilentChunks = 0
	}

	private struct TimedFrame {
		let samples: [Float]
		let startSeconds: Double
		let format: AVAudioFormat
	}

	private struct FrameAssembler {
		private var samples: [Float] = []
		private var startSeconds: Double?

		mutating func append(buffer: AVAudioPCMBuffer, hostTime: UInt64, frameSize: Int) -> [TimedFrame] {
			guard let channel = buffer.floatChannelData?[0], frameSize > 0 else {
				return []
			}
			let count = Int(buffer.frameLength)
			guard count > 0 else {
				return []
			}
			let observedSeconds = AVAudioTime.seconds(forHostTime: hostTime)
			var pendingStartSeconds = startSeconds ?? observedSeconds
			let expectedSeconds = pendingStartSeconds + Double(samples.count) / buffer.format.sampleRate
			if abs(observedSeconds - expectedSeconds) > 0.02 {
				samples.removeAll(keepingCapacity: true)
				pendingStartSeconds = observedSeconds
			}

			samples.append(contentsOf: UnsafeBufferPointer(start: channel, count: count))
			var frames: [TimedFrame] = []
			var readIndex = 0
			while readIndex + frameSize <= samples.count {
				let frameStart = pendingStartSeconds +
					Double(readIndex) / buffer.format.sampleRate
				frames.append(TimedFrame(
					samples: Array(samples[readIndex..<readIndex + frameSize]),
					startSeconds: frameStart,
					format: buffer.format
				))
				readIndex += frameSize
			}
			if readIndex > 0 {
				samples.removeFirst(readIndex)
			}
			startSeconds = pendingStartSeconds + Double(readIndex) / buffer.format.sampleRate
			return frames
		}
	}

	private struct EchoReductionStats {
		var delayMs: Int?
		var lastEchoRms: Double = 0
		var lastPostRms: Double = 0
		var lastPreRms: Double = 0
		var residualEchoLikelihood: Double?
		var residualEchoLikelihoodRecentMax: Double?
		var processedChunks = 0
		var processedCaptureFrames = 0
		var processedRenderFrames = 0
		var suppressedChunks = 0
		var unavailableChunks = 0
		var lastReason = "waiting_for_render_reference"
	}

	private final class CollectingSink: NativeAudioPcmSink, @unchecked Sendable {
		private let queue = DispatchQueue(label: "com.graneri.combined-audio.collecting-sink")
		private var samples: [Float] = []

		func append(buffer: AVAudioPCMBuffer, hostTime _: UInt64) {
			guard let channel = buffer.floatChannelData?[0] else {
				return
			}

			let frameCount = Int(buffer.frameLength)
			guard frameCount > 0 else {
				return
			}

			let nextSamples = Array(UnsafeBufferPointer(start: channel, count: frameCount))
			queue.sync {
				samples.append(contentsOf: nextSamples)
			}
		}

		func snapshot() -> [Float] {
			queue.sync {
				samples
			}
		}
	}

	private(set) lazy var microphoneSink: NativeAudioPcmSink = SourceSink {
		[weak self] buffer, hostTime in
		self?.handleMicrophoneBuffer(buffer, hostTime: hostTime)
	}
	private(set) lazy var systemAudioSink: NativeAudioPcmSink = SourceSink {
		[weak self] buffer, hostTime in
		self?.handleSystemAudioBuffer(buffer, hostTime: hostTime)
	}
	private let logger: NativeAudioStderrLogger
	private let microphoneOutput: NativeAudioPcmSink
	private let onDiagnostics: (@Sendable ([String: Any]) -> Void)?
	private let systemAudioOutput: NativeAudioPcmSink
	private let queue = DispatchQueue(label: "com.graneri.combined-audio.processing")
	private var aecProcessor: WebRtcAec3Processor?
	private var echoReductionStats = EchoReductionStats()
	private var microphoneFrames: [TimedFrame] = []
	private var microphoneFrameAssembler = FrameAssembler()
	private var microphoneStats = SourceStats()
	private var systemAudioFrames: [TimedFrame] = []
	private var systemAudioFrameAssembler = FrameAssembler()
	private var systemAudioStats = SourceStats()

	init(
		logger: NativeAudioStderrLogger,
		microphoneOutput: NativeAudioPcmSink,
		systemAudioOutput: NativeAudioPcmSink,
		onDiagnostics: (@Sendable ([String: Any]) -> Void)? = nil
	) {
		self.logger = logger
		self.microphoneOutput = microphoneOutput
		self.onDiagnostics = onDiagnostics
		self.systemAudioOutput = systemAudioOutput
	}

	static func runSelfTest(logger: NativeAudioStderrLogger) -> SelfTestResult {
		let sampleRate = 48_000.0
		let frameCount = 960
		let delaySamples = 240
		let totalFrames = frameCount * 50 + delaySamples
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let format = AVAudioFormat(
			standardFormatWithSampleRate: sampleRate,
			channels: 1
		)!
		let renderSamples = (0..<totalFrames).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 440.0 / sampleRate) * 0.4)
		}
		let localSpeechSamples = (0..<totalFrames).map { frameIndex in
			let active = frameIndex % Int(sampleRate / 5) < Int(sampleRate / 8)
			let envelope = active ? 0.2 : 0.02
			let time = Double(frameIndex) * 2.0 * .pi / sampleRate
			return Float(
				(sin(time * 1_200.0) * 0.7 + sin(time * 1_700.0) * 0.3) * envelope
			)
		}
		var rawMicrophoneSamples: [Float] = []
		var expectedSpeechSamples: [Float] = []

		for chunkIndex in 0..<50 {
			let renderStart = chunkIndex * frameCount
			let renderBuffer = makeBuffer(
				format: format,
				samples: Array(renderSamples[renderStart..<renderStart + frameCount])
			)
			let hostTime = AVAudioTime.hostTime(
				forSeconds: 1 + Double(renderStart) / sampleRate
			)
			pipeline.systemAudioSink.append(buffer: renderBuffer, hostTime: hostTime)

			let microphoneStart = renderStart + delaySamples
			let microphoneSamples = (0..<frameCount).map { frameOffset in
				let sampleIndex = microphoneStart + frameOffset
				let echoSample = renderSamples[sampleIndex - delaySamples] * 0.65
				let localSpeechSample = localSpeechSamples[sampleIndex]
				return max(-1, min(1, localSpeechSample + echoSample))
			}
			rawMicrophoneSamples.append(contentsOf: microphoneSamples)
			expectedSpeechSamples.append(
				contentsOf: Array(localSpeechSamples[microphoneStart..<microphoneStart + frameCount])
			)
			let microphoneBuffer = makeBuffer(format: format, samples: microphoneSamples)
			pipeline.microphoneSink.append(buffer: microphoneBuffer, hostTime: hostTime)
		}

		let processedSamples = microphoneOutput.snapshot()
		let systemOutputSamples = systemAudioOutput.snapshot()
		let comparableCount = min(
			processedSamples.count,
			rawMicrophoneSamples.count,
			expectedSpeechSamples.count
		)
		let systemComparableCount = min(systemOutputSamples.count, renderSamples.count)
		let rawErrorRms = rmsError(
			Array(rawMicrophoneSamples[0..<comparableCount]),
			Array(expectedSpeechSamples[0..<comparableCount])
		)
		let processedErrorRms = rmsError(
			Array(processedSamples[0..<comparableCount]),
			Array(expectedSpeechSamples[0..<comparableCount])
		)
		let systemOutputErrorRms = rmsError(
			Array(systemOutputSamples[0..<systemComparableCount]),
			Array(renderSamples[0..<systemComparableCount])
		)
		let noRenderPassthroughErrorRms = runNoRenderPassthroughSelfTest(
			format: format,
			logger: logger
		)
		let echoOnlyResidualRatio = runEchoOnlySelfTest(
			format: format,
			logger: logger
		)
		let echoReductionRatio =
			rawErrorRms > 0 ? max(0, 1.0 - processedErrorRms / rawErrorRms) : 0

		return SelfTestResult(
			echoOnlyResidualRatio: echoOnlyResidualRatio,
			echoReductionRatio: echoReductionRatio,
			noRenderPassthroughErrorRms: noRenderPassthroughErrorRms,
			processedErrorRms: processedErrorRms,
			rawErrorRms: rawErrorRms,
			suppressedChunks: pipeline.queue.sync {
				pipeline.echoReductionStats.suppressedChunks
			},
			systemOutputErrorRms: systemOutputErrorRms
		)
	}

	private static func runEchoOnlySelfTest(
		format: AVAudioFormat,
		logger: NativeAudioStderrLogger
	) -> Double {
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let frameCount = 960
		let totalFrames = 50 * frameCount
		let renderSamples = (0..<totalFrames).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 440.0 / format.sampleRate) * 0.4)
		}
		for chunkIndex in 0..<50 {
			let start = chunkIndex * frameCount
			let end = start + frameCount
			let hostTime = AVAudioTime.hostTime(
				forSeconds: 1 + Double(start) / format.sampleRate
			)
			let chunk = Array(renderSamples[start..<end])
			pipeline.systemAudioSink.append(
				buffer: makeBuffer(format: format, samples: chunk),
				hostTime: hostTime
			)
			pipeline.microphoneSink.append(
				buffer: makeBuffer(format: format, samples: chunk.map { $0 * 0.65 }),
				hostTime: hostTime
			)
		}
		let output = microphoneOutput.snapshot()
		let warmupFrames = 10 * frameCount
		guard output.count > warmupFrames else {
			return 1
		}
		let raw = Array(renderSamples[warmupFrames..<min(output.count, totalFrames)])
		let processed = Array(output[warmupFrames..<min(output.count, totalFrames)])
		let rawRms = rmsError(raw.map { $0 * 0.65 }, Array(repeating: 0, count: raw.count))
		let processedRms = rmsError(processed, Array(repeating: 0, count: processed.count))
		return rawRms > 0 ? processedRms / rawRms : 1
	}

	private static func runNoRenderPassthroughSelfTest(
		format: AVAudioFormat,
		logger: NativeAudioStderrLogger
	) -> Double {
		let microphoneOutput = CollectingSink()
		let systemAudioOutput = CollectingSink()
		let pipeline = CombinedAudioProcessingPipeline(
			logger: logger,
			microphoneOutput: microphoneOutput,
			systemAudioOutput: systemAudioOutput
		)
		let frameCount = 960
		let microphoneSamples = (0..<frameCount * 40).map { frameIndex in
			Float(sin(Double(frameIndex) * 2.0 * .pi * 700.0 / format.sampleRate) * 0.2)
		}
		for chunkIndex in 0..<40 {
			let start = chunkIndex * frameCount
			pipeline.microphoneSink.append(
				buffer: makeBuffer(
					format: format,
					samples: Array(microphoneSamples[start..<start + frameCount])
				),
				hostTime: AVAudioTime.hostTime(
					forSeconds: 1 + Double(start) / format.sampleRate
				)
			)
		}

		let processedSamples = microphoneOutput.snapshot()
		guard !processedSamples.isEmpty else {
			return 1
		}
		let comparableCount = min(processedSamples.count, microphoneSamples.count)
		return rmsError(
			Array(processedSamples[0..<comparableCount]),
			Array(microphoneSamples[0..<comparableCount])
		)
	}

	private static func makeBuffer(
		format: AVAudioFormat,
		samples: [Float]
	) -> AVAudioPCMBuffer {
		let buffer = AVAudioPCMBuffer(
			pcmFormat: format,
			frameCapacity: AVAudioFrameCount(samples.count)
		)!
		buffer.frameLength = AVAudioFrameCount(samples.count)
		let channel = buffer.floatChannelData![0]
		for index in 0..<samples.count {
			channel[index] = samples[index]
		}
		return buffer
	}

	private static func rmsError(_ lhs: [Float], _ rhs: [Float]) -> Double {
		let count = min(lhs.count, rhs.count)
		guard count > 0 else {
			return 0
		}

		var sumOfSquares = 0.0
		for index in 0..<count {
			let delta = Double(lhs[index] - rhs[index])
			sumOfSquares += delta * delta
		}

		return sqrt(sumOfSquares / Double(count))
	}

	private static func rms(_ buffer: AVAudioPCMBuffer) -> Double {
		guard let channel = buffer.floatChannelData?[0] else {
			return 0
		}

		let frameCount = Int(buffer.frameLength)
		guard frameCount > 0 else {
			return 0
		}

		var sumOfSquares = 0.0
		for frameIndex in 0..<frameCount {
			let sample = Double(channel[frameIndex])
			sumOfSquares += sample * sample
		}

		return sqrt(sumOfSquares / Double(frameCount))
	}

	private static func rms(_ samples: [Float]) -> Double {
		guard !samples.isEmpty else {
			return 0
		}
		var sumOfSquares = 0.0
		for sample in samples {
			sumOfSquares += Double(sample * sample)
		}
		return sqrt(sumOfSquares / Double(samples.count))
	}

	func describe() -> [String: Any] {
		queue.sync {
			describeLocked()
		}
	}

	private func describeStatsLocked(renderAgeMilliseconds: Double?) -> [String: Any] {
		var event = describeLocked()
		event["microphoneChunks"] = microphoneStats.chunks
		event["microphoneFrames"] = microphoneStats.frames
		event["microphoneLastRms"] = microphoneStats.lastRms
		event["microphoneMaxRms"] = microphoneStats.maxRms
		event["microphoneNonSilentChunks"] = microphoneStats.nonSilentChunks
		event["renderAgeMilliseconds"] = renderAgeMilliseconds ?? NSNull()
		event["systemAudioChunks"] = systemAudioStats.chunks
		event["systemAudioFrames"] = systemAudioStats.frames
		event["systemAudioLastRms"] = systemAudioStats.lastRms
		event["systemAudioMaxRms"] = systemAudioStats.maxRms
		event["systemAudioNonSilentChunks"] = systemAudioStats.nonSilentChunks
		event["type"] = "processing_diagnostics"
		return event
	}

	private func observe(source: String, buffer: AVAudioPCMBuffer) {
		let frameLength = Int(buffer.frameLength)
		let observedAt = DispatchTime.now()
		let rms = Self.rms(buffer)
		if source == "microphone" {
			microphoneStats.chunks += 1
			microphoneStats.frames += frameLength
			microphoneStats.lastRms = rms
			microphoneStats.lastObservedAt = observedAt
			microphoneStats.maxRms = max(microphoneStats.maxRms, rms)
			if rms >= 0.0001 {
				microphoneStats.nonSilentChunks += 1
			}
		} else {
			systemAudioStats.chunks += 1
			systemAudioStats.frames += frameLength
			systemAudioStats.lastRms = rms
			systemAudioStats.lastObservedAt = observedAt
			systemAudioStats.maxRms = max(systemAudioStats.maxRms, rms)
			if rms >= 0.0001 {
				systemAudioStats.nonSilentChunks += 1
			}
		}

		logStatsIfNeeded()
	}

	private func handleMicrophoneBuffer(_ buffer: AVAudioPCMBuffer, hostTime: UInt64) {
		queue.sync {
			observe(source: "microphone", buffer: buffer)
			guard let processor = processorLocked(sampleRate: buffer.format.sampleRate) else {
				microphoneOutput.append(buffer: buffer, hostTime: hostTime)
				return
			}
			microphoneFrames.append(contentsOf: microphoneFrameAssembler.append(
				buffer: buffer,
				hostTime: hostTime,
				frameSize: processor.frameSize
			))
			for processedBuffer in processAlignedFramesLocked() {
				microphoneOutput.append(buffer: processedBuffer, hostTime: hostTime)
			}
		}
	}

	private func handleSystemAudioBuffer(_ buffer: AVAudioPCMBuffer, hostTime: UInt64) {
		queue.sync {
			observe(source: "systemAudio", buffer: buffer)
			guard let processor = processorLocked(sampleRate: buffer.format.sampleRate) else {
				systemAudioOutput.append(buffer: buffer, hostTime: hostTime)
				return
			}
			systemAudioFrames.append(contentsOf: systemAudioFrameAssembler.append(
				buffer: buffer,
				hostTime: hostTime,
				frameSize: processor.frameSize
			))
			for processedBuffer in processAlignedFramesLocked() {
				microphoneOutput.append(buffer: processedBuffer, hostTime: hostTime)
			}
			systemAudioOutput.append(buffer: buffer, hostTime: hostTime)
		}
	}

	private func processAlignedFramesLocked() -> [AVAudioPCMBuffer] {
		let toleranceSeconds = 0.015
		let maximumBufferedFrames = 30
		var microphoneOutputBuffers: [AVAudioPCMBuffer] = []
		var consumedMicrophoneFrames = 0
		var consumedSystemAudioFrames = 0

		while consumedMicrophoneFrames < microphoneFrames.count &&
			consumedSystemAudioFrames < systemAudioFrames.count
		{
			let microphoneFrame = microphoneFrames[consumedMicrophoneFrames]
			let systemAudioFrame = systemAudioFrames[consumedSystemAudioFrames]
			let offsetSeconds = systemAudioFrame.startSeconds - microphoneFrame.startSeconds
			if offsetSeconds < -toleranceSeconds {
				appendRenderReferenceLocked(systemAudioFrame)
				consumedSystemAudioFrames += 1
				continue
			}
			if offsetSeconds > toleranceSeconds {
				microphoneOutputBuffers.append(Self.makeBuffer(
					format: microphoneFrame.format,
					samples: microphoneFrame.samples
				))
				consumedMicrophoneFrames += 1
				continue
			}
			appendRenderReferenceLocked(systemAudioFrame)
			microphoneOutputBuffers.append(reduceEchoLocked(microphoneFrame))
			consumedMicrophoneFrames += 1
			consumedSystemAudioFrames += 1
		}

		if consumedMicrophoneFrames > 0 {
			microphoneFrames.removeFirst(consumedMicrophoneFrames)
		}
		if consumedSystemAudioFrames > 0 {
			systemAudioFrames.removeFirst(consumedSystemAudioFrames)
		}
		if systemAudioFrames.count > maximumBufferedFrames {
			let droppedFrames = systemAudioFrames.count - maximumBufferedFrames
			for frame in systemAudioFrames.prefix(droppedFrames) {
				appendRenderReferenceLocked(frame)
			}
			systemAudioFrames.removeFirst(droppedFrames)
		}
		if microphoneFrames.count > maximumBufferedFrames {
			let passthroughFrames = microphoneFrames.count - maximumBufferedFrames
			for frame in microphoneFrames.prefix(passthroughFrames) {
				microphoneOutputBuffers.append(Self.makeBuffer(
					format: frame.format,
					samples: frame.samples
				))
			}
			microphoneFrames.removeFirst(passthroughFrames)
		}
		return microphoneOutputBuffers
	}

	private func appendRenderReferenceLocked(_ frame: TimedFrame) {
		let processor = processorLocked(sampleRate: frame.format.sampleRate)
		if let processor {
			echoReductionStats.processedRenderFrames += processor.analyzeRender(samples: frame.samples)
			echoReductionStats.lastReason = "render_reference_analyzed"
		} else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "aec3_unavailable"
		}
	}

	private func reduceEchoLocked(_ frame: TimedFrame) -> AVAudioPCMBuffer {
		guard let processor = processorLocked(sampleRate: frame.format.sampleRate) else {
			echoReductionStats.unavailableChunks += 1
			echoReductionStats.lastReason = "aec3_unavailable"
			return Self.makeBuffer(format: frame.format, samples: frame.samples)
		}

		guard echoReductionStats.processedRenderFrames > 0 else {
			echoReductionStats.lastPostRms = Self.rms(frame.samples)
			echoReductionStats.lastPreRms = echoReductionStats.lastPostRms
			echoReductionStats.lastReason = "waiting_for_render_reference"
			return Self.makeBuffer(format: frame.format, samples: frame.samples)
		}
		let processed = processor.processCapture(samples: frame.samples)
		let preRms = Self.rms(frame.samples)
		let postRms = Self.rms(processed.samples)
		let processorStats = processor.stats()
		let residualEchoLikelihood = processorStats.residualEchoLikelihood.isFinite
			? processorStats.residualEchoLikelihood
			: nil
		let residualEchoLikelihoodRecentMax = processorStats
			.residualEchoLikelihoodRecentMax
			.isFinite
			? processorStats.residualEchoLikelihoodRecentMax
			: nil
		echoReductionStats.processedChunks += 1
		echoReductionStats.processedCaptureFrames += processed.processedFrames
		if processed.processedFrames > 0 && postRms < preRms * 0.95 {
			echoReductionStats.suppressedChunks += 1
		}
		echoReductionStats.delayMs = processorStats.delayMs >= 0
			? Int(processorStats.delayMs)
			: nil
		echoReductionStats.lastEchoRms = max(0, preRms - postRms)
		echoReductionStats.lastPostRms = postRms
		echoReductionStats.lastPreRms = preRms
		echoReductionStats.residualEchoLikelihood = residualEchoLikelihood
		echoReductionStats.residualEchoLikelihoodRecentMax = residualEchoLikelihoodRecentMax
		echoReductionStats.lastReason = processed.processedFrames > 0
			? "aec3_active"
			: "aec3_waiting_for_full_capture_frame"
		return Self.makeBuffer(format: frame.format, samples: processed.samples)
	}

	private func processorLocked(sampleRate: Double) -> WebRtcAec3Processor? {
		if let aecProcessor,
			abs(aecProcessor.sampleRate - sampleRate) < 1
		{
			return aecProcessor
		}

		aecProcessor = WebRtcAec3Processor(sampleRate: sampleRate)
		return aecProcessor
	}

	private func logStatsIfNeeded() {
		let totalChunks = microphoneStats.chunks + systemAudioStats.chunks
		guard totalChunks > 0, totalChunks % 200 == 0 else {
			return
		}

		let renderAgeMilliseconds: Double?
		if let renderObservedAt = systemAudioStats.lastObservedAt {
			renderAgeMilliseconds =
				Double(DispatchTime.now().uptimeNanoseconds - renderObservedAt.uptimeNanoseconds) /
				1_000_000
		} else {
			renderAgeMilliseconds = nil
		}

		logger.log(
			"[helper] combined audio processing stats microphoneChunks=\(microphoneStats.chunks) systemAudioChunks=\(systemAudioStats.chunks) microphoneFrames=\(microphoneStats.frames) systemAudioFrames=\(systemAudioStats.frames) microphoneMaxRms=\(microphoneStats.maxRms) systemAudioMaxRms=\(systemAudioStats.maxRms) systemAudioLastRms=\(systemAudioStats.lastRms) systemAudioNonSilentChunks=\(systemAudioStats.nonSilentChunks) renderAgeMs=\(renderAgeMilliseconds.map { String(format: "%.1f", $0) } ?? "null") echoProcessedChunks=\(echoReductionStats.processedChunks) echoProcessedCaptureFrames=\(echoReductionStats.processedCaptureFrames) echoProcessedRenderFrames=\(echoReductionStats.processedRenderFrames) echoSuppressedChunks=\(echoReductionStats.suppressedChunks) echoUnavailableChunks=\(echoReductionStats.unavailableChunks) echoLastReason=\(echoReductionStats.lastReason)"
		)
		onDiagnostics?(describeStatsLocked(renderAgeMilliseconds: renderAgeMilliseconds))
	}

	private func describeLocked() -> [String: Any] {
		[
			"echoCancellation": echoReductionStats.processedChunks > 0
				? "webrtc_aec3"
				: "pending_render_reference",
			"echoCancellationDelayMs": echoReductionStats.delayMs ?? NSNull(),
			"echoCancellationLastEchoRms": echoReductionStats.lastEchoRms,
			"echoCancellationLastPostRms": echoReductionStats.lastPostRms,
			"echoCancellationLastPreRms": echoReductionStats.lastPreRms,
			"echoCancellationLastReason": echoReductionStats.lastReason,
			"echoCancellationProcessedCaptureFrames": echoReductionStats.processedCaptureFrames,
			"echoCancellationProcessedChunks": echoReductionStats.processedChunks,
			"echoCancellationProcessedRenderFrames": echoReductionStats.processedRenderFrames,
			"echoCancellationResidualEchoLikelihood": echoReductionStats.residualEchoLikelihood ?? NSNull(),
			"echoCancellationResidualEchoLikelihoodRecentMax": echoReductionStats
				.residualEchoLikelihoodRecentMax ?? NSNull(),
			"echoCancellationSuppressedChunks": echoReductionStats.suppressedChunks,
			"echoCancellationUnavailableChunks": echoReductionStats.unavailableChunks,
			"microphoneOutput": "echo_reduced",
			"renderReference": "systemAudio",
			"stage": "combined-render-reference",
		]
	}
}
