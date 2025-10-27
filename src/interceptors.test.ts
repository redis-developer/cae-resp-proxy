import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SimpleStringReply } from "@redis/client/dist/lib/RESP/types";
import { createClient } from "redis";

import { getFreePortNumber } from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy.ts";
import { createApp } from "./app";
import createMockRedisServer from "./mock-server";

describe("POST /interceptors", () => {
	let app: any;
	let proxy: any;
	let mockRedisServer: any;
	let targetPort: number;

	beforeAll(async () => {
		const freePort = await getFreePortNumber();
		targetPort = await getFreePortNumber();

		mockRedisServer = createMockRedisServer(targetPort);

		const testConfig = {
			listenPort: freePort,
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

	beforeEach(() => {
		proxy.setGlobalInterceptors([]);
	});

	test("Interceptor matches command and returns custom response", async () => {
		const client = createClient({
			socket: {
				host: "127.0.0.1",
				port: proxy.config.listenPort,
			},
		});

		await client.connect();
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Set up interceptor for PING command
		const pingMatch = Buffer.from("*1\r\n$4\r\nPING\r\n").toString("base64");
		const pingResponse = Buffer.from("+INTERCEPTED_PING\r\n").toString("base64");

		const interceptorRes = await app.request("/interceptors", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "ping-interceptor",
				match: pingMatch,
				response: pingResponse,
				encoding: "base64",
			}),
		});

		expect(interceptorRes.status).toBe(200);

		// Command should be intercepted
		const result = await client.sendCommand(["PING"]);
		expect(result).toBe("INTERCEPTED_PING" as unknown as SimpleStringReply);

		// Non-matching command should pass through
		const fooResult = await client.sendCommand(["FOO"]);
		expect(fooResult).toBe("BAR" as unknown as SimpleStringReply);

		await client.disconnect();
	});

	test("Multiple interceptors can be added and work independently", async () => {
		const client = createClient({
			socket: {
				host: "127.0.0.1",
				port: proxy.config.listenPort,
			},
		});

		await client.connect();
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Add first interceptor for GET command
		const getMatch = Buffer.from("*2\r\n$3\r\nGET\r\n$7\r\nTESTKEY\r\n").toString("base64");
		const getResponse = Buffer.from("$11\r\nINTERCEPTED\r\n").toString("base64");

		const interceptor1Res = await app.request("/interceptors", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "get-interceptor",
				match: getMatch,
				response: getResponse,
				encoding: "base64",
			}),
		});

		expect(interceptor1Res.status).toBe(200);

		// Add second interceptor for SET command
		const setMatch = Buffer.from(
			"*3\r\n$3\r\nSET\r\n$7\r\nTESTKEY\r\n$9\r\nTESTVALUE\r\n",
		).toString("base64");
		const setResponse = Buffer.from("+INTERCEPTED_SET\r\n").toString("base64");

		const interceptor2Res = await app.request("/interceptors", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "set-interceptor",
				match: setMatch,
				response: setResponse,
				encoding: "base64",
			}),
		});

		expect(interceptor2Res.status).toBe(200);

		// GET command should be intercepted by first interceptor
		const getResult = await client.get("TESTKEY");
		expect(getResult).toBe("INTERCEPTED");

		// SET command should be intercepted by second interceptor
		const setResult = await client.set("TESTKEY", "TESTVALUE");
		expect(setResult).toBe("INTERCEPTED_SET");

		// Non-matching commands should still pass through
		const pingResult = await client.sendCommand(["PING"]);
		expect(pingResult).toBe("PONG" as unknown as SimpleStringReply);

		await client.disconnect();
	});

	test("Interceptor does not affect pass-through commands", async () => {
		const client = createClient({
			socket: {
				host: "127.0.0.1",
				port: proxy.config.listenPort,
			},
		});

		await client.connect();
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Add interceptor for specific command
		const match = Buffer.from("*1\r\n$5\r\nINTER\r\n").toString("base64");
		const response = Buffer.from("+CAUGHT\r\n").toString("base64");

		await app.request("/interceptors", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "selective-interceptor",
				match,
				response,
				encoding: "base64",
			}),
		});

		// All normal commands should still work
		const pingResult = await client.sendCommand(["PING"]);
		expect(pingResult).toBe("PONG" as unknown as SimpleStringReply);

		const fooResult = await client.sendCommand(["FOO"]);
		expect(fooResult).toBe("BAR" as unknown as SimpleStringReply);

		// Only the specific intercepted command should be affected
		const interResult = await client.sendCommand(["INTER"]);
		expect(interResult).toBe("CAUGHT" as unknown as SimpleStringReply);

		await client.disconnect();
	});
});
