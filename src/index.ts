import { createApp } from "./app";

const { app, config } = createApp();
export default {
	port: config.apiPort,
	fetch: app.fetch,
	development: false,
};
