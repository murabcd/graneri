import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { expect, test } from "vitest";
import { GeneratedChart } from "@/components/chat/generated-chart";
import { rechartsPromise } from "@/components/chat/recharts-loader";

test("loads the chart runtime when a generated chart is rendered", async () => {
	await act(async () => {
		render(
			<React.Suspense fallback={<span>Loading chart</span>}>
				<GeneratedChart
					spec={{
						chartType: "bar",
						config: { value: { label: "Value" } },
						data: [{ month: "January", value: 42 }],
						title: "Monthly values",
						xKey: "month",
						yKeys: ["value"],
					}}
				/>
			</React.Suspense>,
		);
		await rechartsPromise;
	});

	expect(screen.getByText("Monthly values")).not.toBeNull();
	expect(screen.queryByText("Loading chart")).toBeNull();
});
