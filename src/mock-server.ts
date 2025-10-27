export default function createMockRedisServer(targetPort: number) {
	return Bun.listen({
		hostname: "127.0.0.1",
		port: targetPort,
		socket: {
			data(socket, data) {
				const command = data.toString();
				console.log("Mock Redis received:", command.replace(/\r\n/g, "\\r\\n"));

				// Count how many Redis commands are in this data packet
				// Each command starts with * followed by number of arguments
				const commandCount = (command.match(/\*\d+\r\n/g) || []).length;
				console.log("Command count:", commandCount);

				let responses = "";

				if (command.includes("HELLO")) {
					responses +=
						"*7\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.2.0\r\n$5\r\nproto\r\n:3\r\n$2\r\nid\r\n:1\r\n";
				}

				if (command.includes("CLIENT")) {
					const clientCommands = (command.match(/\*4\r\n\$6\r\nCLIENT\r\n/g) || []).length;
					for (let i = 0; i < clientCommands; i++) {
						responses += "+OK\r\n";
					}
				}

				if (command.includes("AUTH") && !command.includes("CLIENT")) {
					responses += "+OK\r\n";
				}
				if (command.includes("PING") && !command.includes("CLIENT")) {
					responses += "+PONG\r\n";
				}
				if (command.includes("FOO")) {
					responses += "+BAR\r\n";
				}
				if (command.includes("SELECT") && !command.includes("CLIENT")) {
					responses += "+OK\r\n";
				}
				if (command.includes("INFO") && !command.includes("CLIENT")) {
					responses += "$23\r\n# Server\r\nredis_version:7.2.0\r\n";
				}

				// If no specific responses were generated, send OK for each command
				if (!responses) {
					for (let i = 0; i < commandCount; i++) {
						responses += "+OK\r\n";
					}
				}

				console.log("Sending responses:", responses.replace(/\r\n/g, "\\r\\n"));
				socket.write(responses);
			},
			open() {
				console.log("Mock Redis TCP connection opened");
			},
			close() {
				console.log("Mock Redis TCP connection closed");
			},
			error(error) {
				console.error("Mock Redis TCP error:", error);
			},
		},
	});
}
