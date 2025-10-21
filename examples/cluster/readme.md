# Cluster Example

Short example demonstrating how to use the Proxy in front of a Redis Cluster setup.

Run the setup
```bash
docker compose up
```
This will start a 3 node Redis Cluster (ports 3000, 3001, 3002) and a Proxy instance (ports 6379, 6479 and 6579 for proxying and 4000 for the REST API).

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
      3) "7183e22bdcbae8338909fe5282a88ba62d88bdd4"
      4) (empty array)
2) 1) (integer) 5461
   2) (integer) 10922
   3) 1) "0.0.0.0"
      2) (integer) 6479
      3) "a6a3e1859b33451c0d56569dc10a5aa6e32eef32"
      4) (empty array)
3) 1) (integer) 10923
   2) (integer) 16383
   3) 1) "0.0.0.0"
      2) (integer) 6579
      3) "8ee7f4ab67b3da89575cd6f912c645f52e6b962b"
      4) (empty array)
```

```bash
redis-cli subscribe foo
```

Open another terminal

Encode your messagee
```bash
echo '>3\r\n$7\r\nmessage\r\n$3\r\nfoo\r\n$4\r\neeee\r' | base64
PjMNCiQ3DQptZXNzYWdlDQokMw0KZm9vDQokNA0KZWVlZQ0K
```

Push the message to all connected clients
```bash
curl -X POST "http://localhost:4000/send-to-all-clients?encoding=base64" -d "PjMNCiQ3DQptZXNzYWdlDQokMw0KZm9vDQokNA0KZWVlZQ0K"
```

You should see the following message in the `redis-cli subscribe` terminal:
```
1) "message"
2) "foo"
3) "eeee"
```
