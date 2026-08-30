import betterAuth from "@convex-dev/better-auth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		ARTIFACT_WORKER_SECRET: v.string(),
		ARTIFACT_WORKER_URL: v.string(),
	},
});

app.use(betterAuth);
app.use(rateLimiter);
app.use(workflow);

export default app;
