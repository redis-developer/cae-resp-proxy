import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { ProxyConfig } from "redis-monorepo/packages/test-utils/lib/redis-proxy.ts";
import { RedisProxy } from "redis-monorepo/packages/test-utils/lib/redis-proxy.ts";

import {
	connectionIdsQuerySchema,
	encodingSchema,
	getConfig,
	paramSchema,
	parseBuffer,
} from "./util.ts";

export function createApp(testConfig?: ProxyConfig & { readonly apiPort?: number }) {
	const config = testConfig || getConfig();
	const app = new Hono();
	app.use(logger());

	const proxy = new RedisProxy(config);
	proxy.start().catch(console.error);
	app.get("/stats", (c) => {
		return c.json(proxy.getStats());
	});

	app.get("/connections", (c) => {
		return c.json({ connectionIds: proxy.getActiveConnectionIds() });
	});

	app.post(
		"/send-to-client/:connectionId",
		zValidator("param", paramSchema),
		zValidator("query", encodingSchema),
		async (c) => {
			const { connectionId } = c.req.valid("param");
			const { encoding } = c.req.valid("query");
			const data = await c.req.text();

			const buffer = parseBuffer(data, encoding);
			const result = proxy.sendToClient(connectionId, buffer);
			return c.json(result);
		},
	);

	app.post("/send-to-clients", zValidator("query", connectionIdsQuerySchema), async (c) => {
		const { connectionIds, encoding } = c.req.valid("query");
		const data = await c.req.text();

		const buffer = parseBuffer(data, encoding);
		const results = proxy.sendToClients(connectionIds, buffer);
		return c.json({ results });
	});

	app.post("/send-to-all-clients", zValidator("query", encodingSchema), async (c) => {
		const { encoding } = c.req.valid("query");
		const data = await c.req.text();

		const buffer = parseBuffer(data, encoding);
		const results = proxy.sendToAllClients(buffer);
		return c.json({ results });
	});

	app.delete("/connections/:id", (c) => {
		const connectionId = c.req.param("id");
		const success = proxy.closeConnection(connectionId);
		return c.json({ success, connectionId });
	});

	return { app, proxy, config };
}
