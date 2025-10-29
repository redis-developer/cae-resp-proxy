import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SimpleStringReply } from "@redis/client/dist/lib/RESP/types";
import { createClient } from "redis";

import { getFreePortNumber } from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy.ts";
import { createApp } from "./app";
import createMockRedisServer from "./mock-server";

describe("POST /scenarios", () => {
	let app: any;
	let proxy: any;
	let mockRedisServer: any;
	let targetPort: number;

	beforeAll(async () => {
		const freePort = await getFreePortNumber();
		targetPort = await getFreePortNumber();

		mockRedisServer = createMockRedisServer(targetPort);

		const testConfig = {
			listenPort: [freePort],
			listenHost: "127.0.0.1",
			targetHost: "127.0.0.1",
			targetPort: targetPort,
			timeout: 30000,
			enableLogging: true,
			apiPort: 3001,
		};

		const appInstance = createApp(testConfig);
		app = appInstance.app;
		proxy = appInstance.proxy;

		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	afterAll(async () => {
		if (proxy) {
			await proxy.stop();
		}
		if (mockRedisServer) {
			mockRedisServer?.stop(true);
		}
	});

	test("POST /scenarios with invalid data", async () => {
		const res = await app.request("/scenarios", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
	});

	test("POST /scenarios with empty responses", async () => {
		const res = await app.request("/scenarios", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ responses: [] }),
		});

		expect(res.status).toBe(400);
	});

	test("POST /scenarios with raw encoding", async () => {
		const res = await app.request("/scenarios", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				responses: ["+FIRST\r\n", "+SECOND\r\n", "+THIRD\r\n"],
				encoding: "raw",
			}),
		});

		expect(res.status).toBe(200);
		const result = await res.json();
		expect(result.success).toBe(true);
		expect(result.totalResponses).toBe(3);
	});

	test("POST /scenarios with base64 encoding", async () => {
		const response1 = Buffer.from("+RESPONSE1\r\n").toString("base64");
		const response2 = Buffer.from("+RESPONSE2\r\n").toString("base64");

		const res = await app.request("/scenarios", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				responses: [response1, response2],
				encoding: "base64",
			}),
		});

		expect(res.status).toBe(200);
		const result = await res.json();
		expect(result.success).toBe(true);
		expect(result.totalResponses).toBe(2);
	});

	test("Scenario interceptor returns responses sequentially then passes through", async () => {
		const client = createClient({
			socket: {
				host: "127.0.0.1",
				port: proxy.config.listenPort,
			},
		});

		await client.connect();
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Set up scenario with 2 responses
		const scenarioRes = await app.request("/scenarios", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				responses: ["+SCENARIO1\r\n", "+SCENARIO2\r\n"],
				encoding: "raw",
			}),
		});

		expect(scenarioRes.status).toBe(200);

		// First command should get first scenario response
		const result1 = await client.sendCommand(["PING"]);
		expect(result1).toBe("SCENARIO1" as unknown as SimpleStringReply);

		// Second command should get second scenario response
		const result2 = await client.sendCommand(["PING"]);
		expect(result2).toBe("SCENARIO2" as unknown as SimpleStringReply);

		// Third command should pass through to real server
		const result3 = await client.sendCommand(["PING"]);
		expect(result3).toBe("PONG" as unknown as SimpleStringReply);

		// Fourth command should also pass through
		const result4 = await client.sendCommand(["FOO"]);
		expect(result4).toBe("BAR" as unknown as SimpleStringReply);

		await client.disconnect();
	});
});
