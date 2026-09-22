import { getOnlyComponentModule } from "@/lib/component-entry";
import type { Recharts } from "./recharts-runtime";

export const rechartsPromise = getOnlyComponentModule(
	import.meta.glob<{ Recharts: typeof Recharts }>("./recharts-runtime.ts"),
)().then((module) => module.Recharts);
