# Redis RESP Proxy

[![Test](https://github.com/redis-developer/cae-resp-proxy/actions/workflows/test.yml/badge.svg)](https://github.com/redis-developer/cae-resp-proxy/actions/workflows/test.yml)

A Redis protocol proxy with HTTP API for response injection.

## Features

- **Redis Transparent Protocol Proxy**: Forwards Redis connections from clients to target Redis servers
- **HTTP API**: RESTful API for managing connections and sending arbitrary responses to clients
- **Connection Management**: Track active connections, view statistics, and close connections
- **Data Encoding Support**: Send data in base64 or raw binary format
- **Docker Support**: Containerized deployment with environment variable configuration
- **Real-time Stats**: Monitor active connections and proxy statistics

## Quick Start

### Prerequisites
- Docker or [Bun](https://bun.sh/) runtime
- Running Redis server (target)

### Basic Usage

#### Docker (Recommended)

The easiest way to get started is with Docker :


```bash
# Build the docker image first
docker build -t resp-proxy .
```



```bash
# Run with Docker - connects to Redis on host
docker run -d \
  -p 6379:6379 \ # the proxy will listen for incoming connections on this port
  -p 3000:3000 \ # the rest api will listen for http requests on this port
  -e TARGET_HOST=host.docker.internal \ #<-- redis server host ( the proxy target )
  -e TARGET_PORT=6380 \ # redis server port
  -e LISTEN_PORT=6379 \ # proxy listen port
  -e API_PORT = 3000 \ # rest api port 
  resp-proxy
```

### Local Development 

```bash
# Install dependencies
bun install

# Start the proxy with CLI arguments
bun run proxy --listenPort=6379 --targetHost=localhost --targetPort=6380

# Or use the dev mode with hot reload
bun run dev --listenPort=6379 --targetHost=localhost --targetPort=6380
```

#### Environment Variables
You can use env variables instead of cli arguments.

```bash
# Set required environment variables
export LISTEN_PORT=6379
export TARGET_HOST=localhost
export TARGET_PORT=6380

# Optional variables
export LISTEN_HOST=127.0.0.1
export TIMEOUT=30000
export ENABLE_LOGGING=true
export API_PORT=3000

# Start the proxy
bun run proxy
```

## Configuration

### Required Parameters

| Parameter | CLI Flag | Environment Variable | Description |
|-----------|----------|---------------------|-------------|
| Target Host | `--targetHost` | `TARGET_HOST` | Redis server hostname/IP |
| Target Port | `--targetPort` | `TARGET_PORT` | Redis server port |

### Optional Parameters

| Parameter | CLI Flag | Environment Variable | Default | Description |
|-----------|----------|---------------------|---------|-------------|
| Listen Port | `--listenPort` | `LISTEN_PORT` | `6379` | Port for Redis clients to connect to |
| Listen Host | `--listenHost` | `LISTEN_HOST` | `127.0.0.1` | Host interface to bind to |
| Timeout | `--timeout` | `TIMEOUT` | - | Connection timeout (ms) |
| Enable Logging | `--enableLogging` | `ENABLE_LOGGING` | `false` | Verbose logging |
| API Port | `--apiPort` | `API_PORT` | `3000` | HTTP API port |

## HTTP API Reference

The proxy provides a REST API for managing connections and sending arbitrary responses.


### Endpoints


#### Get Statistics
```http
GET /stats
```
Returns detailed proxy statistics including active connections, total connections, and connection details.

**Response:**
```json
{
  "activeConnections": 2,
  "totalConnections": 5,
  "connections": [
    {
      "id": "conn_123",
      "clientAddress": "127.0.0.1:54321",
      "connectedAt": "2024-01-01T10:00:00Z"
    }
  ]
}
```

#### Get Active Connections
```http
GET /connections
```
Returns list of active connection IDs.

**Response:**
```json
{
  "connectionIds": ["conn_123", "conn_456"]
}
```

#### Send Data to Specific Client
```http
POST /send-to-client/{connectionId}?encoding={base64|raw}
```
Send Redis protocol data to a specific client connection.

**Parameters:**
- `connectionId` (path): Target connection ID
- `encoding` (query): Data encoding format (`base64` or `raw`, default: `base64`)

**Body:** Raw data or base64-encoded data

**Example:**
```bash
# Send PING command (base64 encoded)
curl -X POST "http://localhost:3000/send-to-client/conn_123?encoding=base64" \
  -d "KjENCiQ0DQpQSU5HDQo="

# Send raw binary data
curl -X POST "http://localhost:3000/send-to-client/conn_123?encoding=raw" \
  --data-binary "*1\r\n$4\r\nPING\r\n"
```

**Response:**
```json
{
  "success": true,
  "connectionId": "conn_123"
}
```

#### Send Data to Multiple Clients
```http
POST /send-to-clients?connectionIds={id1,id2}&encoding={base64|raw}
```
Send data to multiple specific client connections.

**Parameters:**
- `connectionIds` (query): Comma-separated list of connection IDs
- `encoding` (query): Data encoding format (`base64` or `raw`, default: `base64`)

**Example:**
```bash
curl -X POST "http://localhost:3000/send-to-clients?connectionIds=conn_123,conn_456&encoding=base64" \
  -d "KjENCiQ0DQpQSU5HDQo="
```

#### Send Data to All Clients
```http
POST /send-to-all-clients?encoding={base64|raw}
```
Broadcast data to all active client connections.

**Example:**
```bash
curl -X POST "http://localhost:3000/send-to-all-clients?encoding=base64" \
  -d "KjENCiQ0DQpQSU5HDQo="
```

#### Close Connection
```http
DELETE /connections/{connectionId}
```
Forcefully close a specific client connection.

**Response:**
```json
{
  "success": true,
  "connectionId": "conn_123"
}
```

## Use Cases

### Testing Redis Applications
Intercept and inspect Redis commands during development and testing.

### Response Injection
Send custom Redis responses to specific clients for testing scenarios.

### Protocol Analysis
Analyze Redis protocol communication patterns.

## Development

### Running Tests

```bash
bun test
```

### Development Mode

```bash
bun run dev --targetHost=localhost --targetPort=6380
```
