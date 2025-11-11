import type {
	InterceptorDescription,
	InterceptorState,
	Next,
	RedisProxy,
} from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy";

// Sets up an interceptor that simulates Redis Cluster behavior by responding to CLUSTER SLOTS command
export default function createClusterInterceptor(proxies: RedisProxy[]): InterceptorDescription {
	return {
		name: `cluster-simulation-interceptor`,
		fn: async (data: Buffer, next: Next, state: InterceptorState) => {
			state.invokeCount++;

			if (data.toString().toLowerCase() !== "*2\r\n$7\r\ncluster\r\n$5\r\nslots\r\n") {
				return next(data);
			}

			state.matchCount++;

			const slotLenght = Math.floor(16384 / proxies.length);

			let current = -1;
			const mapping = proxies.map((proxy, i) => {
				const from = current + 1;
				const to = i === proxies.length - 1 ? 16383 : current + slotLenght;
				current = to;
				const id = `proxy-id-${proxy.config.listenPort}`;
				return `*3\r\n:${from}\r\n:${to}\r\n*3\r\n$${proxy.config.listenHost.length}\r\n${proxy.config.listenHost}\r\n:${proxy.config.listenPort}\r\n$${id.length}\r\n${id}\r\n`;
			});

			const response = `*${proxies.length}\r\n${mapping.join("")}`;
			return Buffer.from(response);
		},
	};
}
