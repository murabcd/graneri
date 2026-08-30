import { describe, expect, it } from "vitest";
import { parseChartSpecInput } from "../src/chart-generation-tool.mjs";

describe("chart generation input boundary", () => {
	it("repairs common model aliases and numeric strings before validation", () => {
		expect(
			parseChartSpecInput({
				type: "column chart",
				x_key: "Month label",
				yKey: "Revenue USD",
				data: [
					{ "Month label": "Jan", "Revenue USD": "1200" },
					{ "Month label": "Feb", "Revenue USD": "1450" },
				],
			}),
		).toMatchObject({
			chartType: "bar",
			xKey: "Month_label",
			yKeys: ["Revenue_USD"],
			data: [
				{ Month_label: "Jan", Revenue_USD: 1200 },
				{ Month_label: "Feb", Revenue_USD: 1450 },
			],
		});
	});

	it("still rejects a chart without a finite numeric series", () => {
		expect(() =>
			parseChartSpecInput({
				chartType: "line",
				data: [{ month: "Jan", revenue: "unknown" }],
			}),
		).toThrow();
	});

	it("keeps colliding normalized source keys distinct", () => {
		expect(
			parseChartSpecInput({
				type: "bar",
				xKey: "Month label",
				yKeys: ["Revenue USD", "Revenue@USD"],
				data: [
					{
						"Month label": "Jan",
						"Revenue USD": 1200,
						"Revenue@USD": 1300,
					},
				],
			}),
		).toMatchObject({
			xKey: "Month_label",
			yKeys: ["Revenue_USD", "Revenue_USD_2"],
			data: [{ Month_label: "Jan", Revenue_USD: 1200, Revenue_USD_2: 1300 }],
		});
	});

	it("does not let a later-row key collision overwrite a plotted value", () => {
		expect(
			parseChartSpecInput({
				type: "bar",
				xKey: "Month label",
				yKey: "Revenue USD",
				data: [
					{ "Month label": "Jan", "Revenue USD": 1200 },
					{
						"Month label": "Feb",
						"Revenue USD": 1450,
						"Revenue@USD": 9999,
					},
				],
			}),
		).toMatchObject({
			yKeys: ["Revenue_USD"],
			data: [
				{ Month_label: "Jan", Revenue_USD: 1200 },
				{
					Month_label: "Feb",
					Revenue_USD: 1450,
					Revenue_USD_2: 9999,
				},
			],
		});
	});
});
