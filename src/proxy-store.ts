import type { RedisProxy } from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy";

export const makeId = (host: string, port: number, listenPort: number): string =>
	listenPort ? `${host}:${port}@${listenPort}` : `${host}:${port}`;

export default class ProxyStore {
	#proxies = new Map<string, RedisProxy>();

	add(id: string, proxy: RedisProxy): void {
		this.#proxies.set(id, proxy);
	}

	async delete(id: string): Promise<boolean> {
		const proxy = this.#proxies.get(id);
		if (!proxy) return false;
		await proxy.stop();
		return this.#proxies.delete(id);
	}

	get nodeIds(): string[] {
		return Array.from(this.#proxies.keys());
	}

	get proxies(): RedisProxy[] {
		return Array.from(this.#proxies.values());
	}

	get entries(): [string, RedisProxy][] {
		return Array.from(this.#proxies.entries());
	}

	getProxyByConnectionId(connectionId: string): RedisProxy | undefined {
		for (const proxy of this.#proxies.values()) {
			if (proxy.getActiveConnectionIds().includes(connectionId)) {
				return proxy;
			}
		}
	}

	getProxiesByConnectionIds(connectionIds: string[]): [RedisProxy, string[]][] {
		const result: [RedisProxy, string[]][] = [];
		for (const proxy of this.#proxies.values()) {
			const activeIds = proxy.getActiveConnectionIds();
			const matchingIds = connectionIds.filter((id) => activeIds.includes(id));
			if (matchingIds.length > 0) {
				result.push([proxy, matchingIds]);
			}
		}
		return result;
	}
}
