import type { InterceptorDescription } from "redis-monorepo/packages/test-utils/lib/proxy/redis-proxy";
import type ProxyStore from "../proxy-store";
import createClusterInterceptor from "./cluster-interceptor";
import createHitlessInterceptor from "./hitless-interceptor";
import createLoggingInterceptor from "./logging-interceptor";

export default function applyDefaultInterceptors(interceptorNames: string, proxyStore: ProxyStore) {
	const interceptors: InterceptorDescription[] = [];
	for (const interceptorName of interceptorNames.split(",").map((i) => i.trim())) {
		switch (interceptorName) {
			case "logger":
				interceptors.push(createLoggingInterceptor());
				break;
			case "cluster":
				interceptors.push(createClusterInterceptor(proxyStore.proxies));
				break;
			case "hitless":
				interceptors.push(createHitlessInterceptor());
				break;
			default:
				console.warn(`Unknown default interceptor: ${interceptorName}`);
		}
	}

	if (interceptors.length) {
		for (const proxy of proxyStore.proxies) {
			for (const interceptor of interceptors) {
				proxy.addGlobalInterceptor(interceptor);
			}
		}
	}
}
