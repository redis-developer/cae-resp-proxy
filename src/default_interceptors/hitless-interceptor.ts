import type {
	InterceptorDescription,
	InterceptorState,
	Next,
} from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy";

export default function createHitlessInterceptor(): InterceptorDescription {
	return {
		name: `hitless-simulation-interceptor`,
		fn: async (data: Buffer, next: Next, state: InterceptorState) => {
			state.invokeCount++;

			if (
				!data
					.toString()
					.toLowerCase()
					.includes("*5\r\n$6\r\nclient\r\n$19\r\nmaint_notifications\r\n$2\r\non\r\n")
			) {
				return next(data);
			}
			state.matchCount++;
			return Buffer.from("+OK\r\n");
		},
	};
}
