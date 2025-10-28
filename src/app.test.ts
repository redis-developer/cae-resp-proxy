import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SimpleStringReply } from "@redis/client/dist/lib/RESP/types";
import { createClient } from "redis";

import {
	getFreePortNumber,
	type RedisProxy,
} from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy.ts";
import { createApp } from "./app";
import createMockRedisServer from "./mock-server";
import { makeId } from "./proxy-store";

const TARGET_HOST = "127.0.0.1";

describe("Redis Proxy API", () => {
	let app: any;
	let proxy: RedisProxy;
	let mockRedisServer: any;
	let targetPort: number;
	let listenPort: number;

	beforeAll(async () => {
		const freePort = await getFreePortNumber();
		listenPort = freePort;
		targetPort = await getFreePortNumber();

		mockRedisServer = createMockRedisServer(targetPort);

		const testConfig = {
			listenPort: freePort,
			listenHost: "127.0.0.1",
			targetHost: TARGET_HOST,
			targetPort: targetPort,
			timeout: 30000,
			enableLogging: true,
			apiPort: 3001,
		};

		const appInstance = createApp(testConfig);
		app = appInstance.app;
		proxy = appInstance.proxy;

		// Give the proxy and mock server a moment to initialize
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

	test("GET /stats", async () => {
		const res = await app.request("/stats");
		expect(res.status).toBe(200);

		const stats = (await res.json())[makeId(TARGET_HOST, targetPort, listenPort)];
		expect(stats).toHaveProperty("activeConnections");
		expect(stats).toHaveProperty("totalConnections");
		expect(stats).toHaveProperty("connections");
		expect(Array.isArray(stats.connections)).toBe(true);
		expect(stats.connections.length).toBe(0);
	});

	test("GET /connections", async () => {
		const res = await app.request("/connections");
		expect(res.status).toBe(200);

		const result = (await res.json())[makeId(TARGET_HOST, targetPort, listenPort)];
		expect(result).toBeArray();
		expect(result.length).toBe(0);
	});

	test("POST /send-to-client with invalid connection", async () => {
		const testData = Buffer.from("PING").toString("base64");

		const res = await app.request("/send-to-client/non-existent-connection?encoding=base64", {
			method: "POST",
			body: testData,
		});

		expect(res.status).toBe(200);
		const result = await res.json();
		expect(result.success).toBe(false);
		expect(result.error).toBe("Connection not found");
		expect(result.connectionId).toBe("non-existent-connection");
	});

	test("POST /send-to-clients with invalid query params", async () => {
		const testData = Buffer.from("PING").toString("base64");

		const res = await app.request("/send-to-clients", {
			method: "POST",
			body: testData,
		});

		expect(res.status).toBe(400); // Should fail validation due to missing connectionIds
	});

	test("POST /send-to-clients with valid connection IDs", async () => {
		const testData = Buffer.from("PING").toString("base64");

		const res = await app.request("/send-to-clients?connectionIds=conn1,conn2&encoding=base64", {
			method: "POST",
			body: testData,
		});

		expect(res.status).toBe(200);
		const result = await res.json();
		expect(result).toHaveProperty("results");
		expect(Array.isArray(result.results)).toBe(true);
	});

	test("POST /send-to-all-clients with no connections", async () => {
		const testData = Buffer.from("PING").toString("base64");

		const res = await app.request("/send-to-all-clients?encoding=base64", {
			method: "POST",
			body: testData,
		});

		expect(res.status).toBe(200);
		const result = await res.json();
		expect(result).toHaveProperty("results");
		expect(Array.isArray(result.results)).toBe(true);
	});

	test("DELETE /connections/:id with invalid connection", async () => {
		const res = await app.request("/connections/non-existent-connection", {
			method: "DELETE",
		});

		expect(res.status).toBe(200);
		const result = await res.json();
		expect(result.success).toBe(false);
		expect(result.connectionId).toBe("non-existent-connection");
	});

	test("TCP socket connection and proxy functionality", async () => {
		// Test direct TCP connection instead of Redis client to avoid CI issues
		const net = require("node:net");

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Test timeout"));
			}, 3000);

			const socket = new net.Socket();

			socket.connect(proxy.config.listenPort, "127.0.0.1", async () => {
				try {
					clearTimeout(timeout);
					console.log("TCP socket connected successfully");

					// Give the connection a moment to be registered
					await new Promise((resolve) => setTimeout(resolve, 100));

					const statsRes = await app.request("/stats");
					expect(statsRes.status).toBe(200);
					const stats = (await statsRes.json())[makeId(TARGET_HOST, targetPort, listenPort)];
					expect(stats.activeConnections).toBe(1);
					expect(stats.totalConnections).toBeGreaterThanOrEqual(1);
					expect(stats.connections.length).toBe(1);

					const connectionsRes = await app.request("/connections");
					expect(connectionsRes.status).toBe(200);
					const connectionsResult = (await connectionsRes.json())[
						makeId(TARGET_HOST, targetPort, listenPort)
					];
					expect(connectionsResult.length).toBe(1);
					const connectionId = connectionsResult[0];
					expect(typeof connectionId).toBe("string");
					expect(connectionId.length).toBeGreaterThan(0);

					let receivedData = "";
					socket.on("data", (data: any) => {
						receivedData += data.toString();
					});

					const pingCommand = Buffer.from("*1\r\n$4\r\nPING\r\n").toString("base64");
					const sendRes = await app.request(`/send-to-client/${connectionId}?encoding=base64`, {
						method: "POST",
						body: pingCommand,
					});

					expect(sendRes.status).toBe(200);
					const sendResult = await sendRes.json();
					expect(sendResult.success).toBe(true);
					expect(sendResult.connectionId).toBe(connectionId);

					// Wait a bit for the data to be received
					await new Promise((resolve) => setTimeout(resolve, 50));
					expect(receivedData).toBe("*1\r\n$4\r\nPING\r\n");

					socket.destroy();

					await new Promise((resolve) => setTimeout(resolve, 100));

					const finalStatsRes = await app.request("/stats");
					const finalStats = (await finalStatsRes.json())[
						makeId(TARGET_HOST, targetPort, listenPort)
					];
					expect(finalStats.activeConnections).toBe(0);

					resolve();
				} catch (err) {
					clearTimeout(timeout);
					socket.destroy();
					reject(err);
				}
			});

			socket.on("error", (err: any) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	});

	test("Redis client connection and command execution", async () => {
		// Test with real Redis client - this should work properly
		const client = createClient({
			socket: {
				host: "127.0.0.1",
				port: proxy.config.listenPort,
			},
		});

		await client.connect();
		console.log("Redis client connected successfully");

		// Give the connection a moment to be registered
		await new Promise((resolve) => setTimeout(resolve, 100));

		const statsRes = await app.request("/stats");
		const stats = (await statsRes.json())[makeId(TARGET_HOST, targetPort, listenPort)];
		expect(stats.activeConnections).toBe(1);
		expect(stats.totalConnections).toBeGreaterThanOrEqual(1);
		expect(stats.connections.length).toBe(1);

		const connectionsRes = await app.request("/connections");
		const connectionsResult = (await connectionsRes.json())[
			makeId(TARGET_HOST, targetPort, listenPort)
		];
		expect(connectionsResult.length).toBe(1);
		const connectionId = connectionsResult[0];

		const result = await client.sendCommand(["FOO"]);
		expect(result).toBe("BAR" as unknown as SimpleStringReply);

		const pingCommand = Buffer.from("*1\r\n$4\r\nPING\r\n").toString("base64");
		const sendRes = await app.request(`/send-to-client/${connectionId}?encoding=base64`, {
			method: "POST",
			body: pingCommand,
		});

		expect(sendRes.status).toBe(200);
		const sendResult = await sendRes.json();
		expect(sendResult.success).toBe(true);
		expect(sendResult.connectionId).toBe(connectionId);

		await client.disconnect();

		// Give the proxy a moment to detect the disconnection
		await new Promise((resolve) => setTimeout(resolve, 100));

		const finalStatsRes = await app.request("/stats");
		const finalStats = (await finalStatsRes.json())[makeId(TARGET_HOST, targetPort, listenPort)];
		expect(finalStats.activeConnections).toBe(0);
	});
});
