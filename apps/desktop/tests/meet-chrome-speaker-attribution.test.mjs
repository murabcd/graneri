import assert from "node:assert/strict";
import test from "node:test";
import { createMeetSpeakerTimeline } from "../src/meet-chrome-speaker-attribution.mjs";

const roster = ({
	at,
	name = "Alex Morgan",
	active = true,
	isSelf = false,
	blindReason,
}) => ({
	type: "roster-changed",
	timestamp: at,
	...(blindReason && { blindReason }),
	participants: [{ name, active, isSelf }],
});

test("attributes only a consistently active remote speaker over the audio interval", () => {
	const timeline = createMeetSpeakerTimeline();
	for (const at of [1_000, 1_500, 2_000, 2_500, 3_000]) {
		timeline.recordRoster(roster({ at }));
	}
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 3_000 }),
		"Alex Morgan",
	);
	timeline.clear();
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 3_000 }),
		null,
	);
});

test("attributes a short observed speech burst within an audio commit", () => {
	const timeline = createMeetSpeakerTimeline();
	for (const at of [1_000, 1_500, 2_000, 2_500, 3_000, 3_500]) {
		timeline.recordRoster(roster({ at, active: at === 2_000 || at === 2_500 }));
	}
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 3_500 }),
		"Alex Morgan",
	);
});

test("attributes one consistently visible named remote when Meet exposes no speaking marker", () => {
	const timeline = createMeetSpeakerTimeline();
	for (const at of [1_000, 1_500, 2_000, 2_500, 3_000]) {
		timeline.recordRoster(roster({ at, active: false }));
	}
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 3_000 }),
		"Alex Morgan",
	);
});

test("abstains from sole-remote inference when the roster is not stable", () => {
	for (const interruption of [
		{
			type: "roster-changed",
			timestamp: 1_500,
			participants: [],
		},
		{
			type: "roster-changed",
			timestamp: 1_500,
			participants: [
				{ name: "Alex Morgan", active: false, isSelf: false },
				{ name: "Sam Lee", active: false, isSelf: false },
			],
		},
	]) {
		const timeline = createMeetSpeakerTimeline();
		timeline.recordRoster(roster({ at: 1_000, active: false }));
		timeline.recordRoster(interruption);
		timeline.recordRoster(roster({ at: 2_000, active: false }));
		assert.equal(
			timeline.resolveName({ startedAt: 1_000, endedAt: 2_000 }),
			null,
		);
	}

	const changedSpeakerTimeline = createMeetSpeakerTimeline();
	changedSpeakerTimeline.recordRoster(roster({ at: 1_000, active: false }));
	changedSpeakerTimeline.recordRoster(roster({ at: 1_500, name: "Sam Lee" }));
	changedSpeakerTimeline.recordRoster(roster({ at: 2_000, name: "Sam Lee" }));
	assert.equal(
		changedSpeakerTimeline.resolveName({ startedAt: 1_000, endedAt: 2_000 }),
		null,
	);
});

test("abstains when Meet is blind, self is speaking, or a remote tile lacks a name", () => {
	for (const event of [
		roster({ at: 1_500, blindReason: "meet-not-focused" }),
		roster({ at: 1_500, isSelf: true }),
		roster({ at: 1_500, name: null }),
	]) {
		const timeline = createMeetSpeakerTimeline();
		timeline.recordRoster(roster({ at: 1_000 }));
		timeline.recordRoster(event);
		timeline.recordRoster(roster({ at: 2_000 }));
		assert.equal(
			timeline.resolveName({ startedAt: 1_000, endedAt: 2_000 }),
			null,
		);
	}
});

test("abstains on simultaneous or changing speakers", () => {
	const timeline = createMeetSpeakerTimeline();
	timeline.recordRoster(roster({ at: 1_000 }));
	timeline.recordRoster(roster({ at: 1_500 }));
	timeline.recordRoster({
		type: "roster-changed",
		timestamp: 2_000,
		participants: [
			{ name: "Alex Morgan", active: true, isSelf: false },
			{ name: "Sam Lee", active: true, isSelf: false },
		],
	});
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 2_000 }),
		null,
	);
	timeline.clear();
	timeline.recordRoster(roster({ at: 1_000 }));
	timeline.recordRoster(roster({ at: 1_500 }));
	timeline.recordRoster(roster({ at: 2_000, name: "Sam Lee" }));
	timeline.recordRoster(roster({ at: 2_500, name: "Sam Lee" }));
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 2_500 }),
		null,
	);
});

test("abstains when evidence is sparse, stale, or outside the turn", () => {
	const timeline = createMeetSpeakerTimeline();
	timeline.recordRoster(roster({ at: 1_000 }));
	timeline.recordRoster(roster({ at: 1_500 }));
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 4_000 }),
		null,
	);
	assert.equal(
		timeline.resolveName({ startedAt: 4_000, endedAt: 5_000 }),
		null,
	);
	timeline.recordRoster(roster({ at: 4_000 }));
	timeline.recordRoster(roster({ at: 4_500 }));
	assert.equal(
		timeline.resolveName({ startedAt: 1_000, endedAt: 4_500 }),
		null,
	);
});

test("rejects malformed native events at the process boundary", () => {
	const timeline = createMeetSpeakerTimeline();
	assert.throws(() =>
		timeline.recordRoster({
			type: "roster-changed",
			timestamp: 1_000,
			participants: [{ name: "Alex Morgan", active: "yes", isSelf: false }],
		}),
	);
});
