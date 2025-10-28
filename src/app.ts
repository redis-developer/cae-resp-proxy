import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logger } from "hono/logger";
import {
	type InterceptorDescription,
	type InterceptorState,
	type Next,
	type ProxyConfig,
	type ProxyStats,
	RedisProxy,
	type SendResult,
} from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy.ts";
import ProxyStore, { makeId } from "./proxy-store.ts";
import {
	type ExtendedProxyConfig,
	connectionIdsQuerySchema,
	encodingSchema,
	getConfig,
	interceptorSchema,
	paramSchema,
	parseBuffer,
	proxyConfigSchema,
	scenarioSchema,
} from "./util.ts";

const startNewProxy = (config: ProxyConfig) => {
	const proxy = new RedisProxy(config);
	proxy.start().catch(console.error);
	return proxy;
};

interface Mapping {
	from: {
		host: string;
		port: number;
	};
	to: {
		host: string;
		port: number;
	};
}

const addressMapping = new Map<string, Mapping>();

const setClusterOverwriteInterceptors = (
	addressMapping: Map<string, Mapping>,
	proxyStore: ProxyStore,
) => {
	const interceptors: InterceptorDescription[] = [];
	for (const mapping of addressMapping.values()) {
		interceptors.push({
			name: `ip-replacer-${mapping.to.port}`,
			fn: async (data: Buffer, next: Next, state: InterceptorState) => {
				state.invokeCount++;
				const response = await next(data);
				// for example $9\r\n127.0.0.1\r\n:3000
				const from = `$${mapping.from.host.length}\r\n${mapping.from.host}\r\n:${mapping.from.port}`;
				if (response.includes(from)) {
					state.matchCount++;
					const to = `$${mapping.to.host.length}\r\n${mapping.to.host}\r\n:${mapping.to.port}`;
					return Buffer.from(response.toString().replaceAll(from, to));
				}
				return response;
			},
		});
	}
	for (const proxy of proxyStore.proxies) {
		proxy.setGlobalInterceptors(interceptors);
	}
};

export function createApp(testConfig?: ExtendedProxyConfig) {
	const config = testConfig || getConfig();
	const app = new Hono();
	app.use(logger());

	const proxyStore = new ProxyStore();

	// Handle both single port and array of ports
	const listenPorts = Array.isArray(config.listenPort) ? config.listenPort : [config.listenPort];

	for (const port of listenPorts) {
		const proxyConfig: ProxyConfig = { ...config, listenPort: port };
		const nodeId = makeId(config.targetHost, config.targetPort, port);
		proxyStore.add(nodeId, startNewProxy(proxyConfig));
		addressMapping.set(nodeId, {
			from: {
				host: config.targetHost,
				port: config.targetPort,
			},
			to: {
				host: config.listenHost ?? "127.0.0.1",
				port: port,
			},
		});
	}

	setClusterOverwriteInterceptors(addressMapping, proxyStore);

	app.post("/nodes", zValidator("json", proxyConfigSchema), async (c) => {
		const data = await c.req.json();
		const cfg: ProxyConfig = { ...config, ...data };
		const nodeId = makeId(cfg.targetHost, cfg.targetPort);
		proxyStore.add(nodeId, startNewProxy(cfg));
		addressMapping.set(nodeId, {
			from: {
				host: cfg.targetHost,
				port: cfg.targetPort,
			},
			to: {
				host: cfg.listenHost ?? "127.0.0.1",
				port: cfg.listenPort,
			},
		});
		setClusterOverwriteInterceptors(addressMapping, proxyStore);
		return c.json({ success: true, cfg });
	});

	app.delete("/nodes/:id", async (c) => {
		const nodeId = c.req.param("id");
		const success = await proxyStore.delete(nodeId);
		addressMapping.delete(nodeId);
		setClusterOverwriteInterceptors(addressMapping, proxyStore);
		return c.json({ success });
	});

	app.get("/nodes", (c) => {
		return c.json({ ids: proxyStore.nodeIds });
	});

	app.get("/stats", (c) => {
		const response = proxyStore.entries.reduce(
			(acc, [id, proxy]) => {
				acc[id] = proxy.getStats();
				return acc;
			},
			{} as Record<string, ProxyStats>,
		);
		return c.json(response);
	});

	app.get("/connections", (c) => {
		const response = proxyStore.entries.reduce(
			(acc, [id, proxy]) => {
				acc[id] = proxy.getActiveConnectionIds();
				return acc;
			},
			{} as Record<string, readonly string[]>,
		);
		return c.json(response);
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

			const proxy = proxyStore.getProxyByConnectionId(connectionId);
			if (!proxy)
				return c.json({
					success: false,
					error: "Connection not found",
					connectionId,
				});

			const result = proxy.sendToClient(connectionId, buffer);
			return c.json(result);
		},
	);

	app.post("/send-to-clients", zValidator("query", connectionIdsQuerySchema), async (c) => {
		const { connectionIds, encoding } = c.req.valid("query");
		const data = await c.req.text();

		const buffer = parseBuffer(data, encoding);

		const results: SendResult[] = [];
		for (const [proxy, matchingConIds] of proxyStore.getProxiesByConnectionIds(connectionIds)) {
			results.push(...proxy.sendToClients(matchingConIds, buffer));
		}
		return c.json({ results });
	});

	app.post("/send-to-all-clients", zValidator("query", encodingSchema), async (c) => {
		const { encoding } = c.req.valid("query");
		const data = await c.req.text();
		const buffer = parseBuffer(data, encoding);
		const results: SendResult[] = [];
		for (const proxy of proxyStore.proxies) {
			results.push(...proxy.sendToAllClients(buffer));
		}
		return c.json({ results });
	});

	app.delete("/connections/:id", (c) => {
		const connectionId = c.req.param("id");
		const proxy = proxyStore.getProxyByConnectionId(connectionId);
		if (!proxy)
			return c.json({
				success: false,
				connectionId,
			});
		const success = proxy.closeConnection(connectionId);
		return c.json({ success, connectionId });
	});

	app.post("/scenarios", zValidator("json", scenarioSchema), async (c) => {
		const { responses, encoding } = c.req.valid("json");

		const responsesBuffers = responses.map((response) => parseBuffer(response, encoding));
		let currentIndex = 0;

		const scenarioInterceptor: InterceptorDescription = {
			name: "scenario-interceptor",
			fn: async (data: Buffer, next: Next, state: InterceptorState): Promise<Buffer> => {
				state.invokeCount++;
				if (currentIndex < responsesBuffers.length) {
					state.matchCount++;
					const response = responsesBuffers[currentIndex] as Buffer;
					currentIndex++;
					return response;
				}
				return await next(data);
			},
		};

		for (const proxy of proxyStore.proxies) {
			proxy.addGlobalInterceptor(scenarioInterceptor);
		}

		return c.json({ success: true, totalResponses: responses.length });
	});

	app.post("/interceptors", zValidator("json", interceptorSchema), async (c) => {
		const { name, match, response, encoding } = c.req.valid("json");

		const responseBuffer = parseBuffer(response, encoding);
		const matchBuffer = parseBuffer(match, encoding);

		const interceptor: InterceptorDescription = {
			name,
			fn: async (data: Buffer, next: Next, state: InterceptorState): Promise<Buffer> => {
				state.invokeCount++;
				if (data.equals(matchBuffer)) {
					state.matchCount++;
					return responseBuffer;
				}
				return next(data);
			},
		};

		for (const proxy of proxyStore.proxies) {
			proxy.addGlobalInterceptor(interceptor);
		}

		return c.json({ success: true, name });
	});

	return { app, proxy: proxyStore.proxies[0], config };
}
