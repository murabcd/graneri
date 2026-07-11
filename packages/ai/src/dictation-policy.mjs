export const DICTATION_AUDIO_CONTENT_TYPE = "audio/wav";

// Convex HTTP actions accept request bodies up to 20 MB. Keep explicit
// headroom for platform framing while retaining more than three minutes of
// 48 kHz mono PCM16 audio.
export const MAX_DICTATION_AUDIO_BYTES = 19_000_000;
export const MAX_DICTATION_PCM_BYTES = MAX_DICTATION_AUDIO_BYTES - 44;
export const DICTATION_AUDIO_EXPIRATION_MS = 15 * 60 * 1000;
