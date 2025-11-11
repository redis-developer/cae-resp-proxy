import type {
	InterceptorDescription,
	InterceptorState,
	Next,
} from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy";

export default function createLoggingInterceptor(): InterceptorDescription {
	return {
		name: `logging-interceptor`,
		fn: async (data: Buffer, next: Next, state: InterceptorState) => {
			state.invokeCount++;
			console.log("[REQ]", data.toString().replaceAll("\r\n", " "));
			const response = await next(data);
			console.log("[RES]", response.toString().replaceAll("\r\n", " "));
			return response;
		},
	};
}
