# Cluster Example

Short example demonstrating how to use the Proxy in cluster simulating mode in front of a standalone Redis.

First, start a standalone Redis server with the client libs test image:
```
docker run -p 3000:3000 redislabs/client-libs-test:8.2
```

Run the proxy in cluster mode:
```bash
docker run \
  -p 6379:6379 -p 6380:6380 -p 6381:6381 -p 4000:4000 \
  -e TARGET_HOST=127.0.0.1 \
  -e TARGET_PORT=3000 \
  -e TIMEOUT=0 \
  -e API_PORT=4000 \
  -e SIMULATE_CLUSTER=yes \
  redislabs/client-resp-proxy

```
This will start a Proxy instance (ports 6379, 6380 and 6381 for proxying and 4000 for the REST API).
The proxy will simulate a cluster with 3 nodes running on ports 6379, 6479 and 6579 by intercepting the `cluster slots` command and returning a fake response.

Open a separate terminal

```bash
redis-cli cluster slots
```

Response should be similar to the following, where the ports are the proxy listen ports ( 6379, 6479 and 6579 ):
```
1) 1) (integer) 0
   2) (integer) 5460
   3) 1) "0.0.0.0"
      2) (integer) 6379
      3) "proxy-id-6379"
2) 1) (integer) 5461
   2) (integer) 10922
   3) 1) "0.0.0.0"
      2) (integer) 6380
      3) "proxy-id-6380"
3) 1) (integer) 10923
   2) (integer) 16383
   3) 1) "0.0.0.0"
      2) (integer) 6381
      3) "proxy-id-6381"
```

```bash
redis-cli subscribe foo
```

Open another terminal

Push a message to all connected clients
```bash
curl -X POST "http://localhost:4000/send-to-all-clients?encoding=raw" --data-binary ">3\r\n$7\r\nmessage\r\n$3\r\nfoo\r\n$4\r\neeee\r\n"
```

You should see the following message in the `redis-cli subscribe` terminal:
```
1) "message"
2) "foo"
3) "eeee"
```

Change cluster topology. This is done by adding an interceptor that will catch the `cluster slots` command and return a different response. In this case we swapped the ports of node 2 and node 3.
```
curl -X POST "http://localhost:4000/interceptors" -H 'Content-Type: application/json' -d '{"name":"test", "match":"*2\r\n$7\r\ncluster\r\n$5\r\nslots\r\n", "response":"*3\r\n*3\r\n:0\r\n:5460\r\n*3\r\n$9\r\n127.0.0.1\r\n:6381\r\n$13\r\nproxy-id-6379\r\n*3\r\n:5461\r\n:10921\r\n*3\r\n$9\r\n127.0.0.1\r\n:6380\r\n$13\r\nproxy-id-6380\r\n*3\r\n:10922\r\n:16383\r\n*3\r\n$9\r\n127.0.0.1\r\n:6379\r\n$13\r\nproxy-id-6381\r\n", "encoding":"raw"}'
```
