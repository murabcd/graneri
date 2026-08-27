import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { CheckCircle2, Circle } from "lucide-react";
import type { api } from "../../../../../convex/_generated/api";

export type ActiveRunPlan = NonNullable<
	FunctionReturnType<typeof api.assistantRunActivity.getActivePlan>
>;

const getCurrentStepIndex = (plan: ActiveRunPlan) => {
	const activeIndex = plan.findIndex(({ status }) => status === "in_progress");
	if (activeIndex >= 0) {
		return activeIndex;
	}
	const pendingIndex = plan.findIndex(({ status }) => status === "pending");
	return pendingIndex >= 0 ? pendingIndex : plan.length - 1;
};

function PlanProgressRing({ plan }: { plan: ActiveRunPlan }) {
	const completedCount = plan.filter(
		({ status }) => status === "completed",
	).length;
	const progress = Math.max(completedCount / plan.length, 0.08);
	const circumference = 2 * Math.PI * 7;

	return (
		<svg
			aria-hidden="true"
			className="size-4 -rotate-90 text-chart-1"
			viewBox="0 0 18 18"
		>
			<circle
				cx="9"
				cy="9"
				r="7"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.2"
				strokeWidth="2"
			/>
			<circle
				cx="9"
				cy="9"
				r="7"
				fill="none"
				stroke="currentColor"
				strokeDasharray={circumference}
				strokeDashoffset={circumference * (1 - progress)}
				strokeLinecap="round"
				strokeWidth="2"
			/>
		</svg>
	);
}

function PlanStepIcon({ status }: { status: ActiveRunPlan[number]["status"] }) {
	if (status === "completed") {
		return <CheckCircle2 aria-hidden="true" className="size-4" />;
	}
	if (status === "in_progress") {
		return <Spinner className="size-4 text-chart-1" />;
	}
	return <Circle aria-hidden="true" className="size-4" />;
}

export function RunPlanProgress({ plan }: { plan: ActiveRunPlan }) {
	const currentStepIndex = getCurrentStepIndex(plan);
	const currentStepNumber = currentStepIndex + 1;

	return (
		<HoverCard closeDelay={100} openDelay={0}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					aria-label={`Step ${currentStepNumber} of ${plan.length}. Show plan`}
					className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-[13px] leading-none text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				>
					<PlanProgressRing plan={plan} />
					<span>
						Step {currentStepNumber} / {plan.length}
					</span>
				</button>
			</HoverCardTrigger>
			<HoverCardContent
				side="top"
				sideOffset={8}
				className="w-auto max-w-80 rounded-xl p-2"
			>
				<ol aria-label="Run plan" className="space-y-2">
					{plan.map(({ status, step }) => (
						<li
							key={step}
							className={cn(
								"flex min-w-0 items-start gap-2 text-sm",
								status === "in_progress"
									? "text-foreground"
									: "text-muted-foreground",
							)}
						>
							<span className="mt-0.5 shrink-0">
								<PlanStepIcon status={status} />
							</span>
							<span className="min-w-0 leading-5">{step}</span>
						</li>
					))}
				</ol>
			</HoverCardContent>
		</HoverCard>
	);
}
