import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { RedisProxy } from 'redis-monorepo/packages/test-utils/lib/redis-proxy.ts'
import { getConfig } from './util.ts'
import type { ProxyConfig } from 'redis-monorepo/packages/test-utils/lib/redis-proxy.ts'

const encodingSchema = z.object({
  encoding: z.enum(['base64', 'raw']).default('base64')
});

const paramSchema = z.object({
  connectionId: z.string()
});

const connectionIdsQuerySchema = z.object({
  connectionIds: z.string().transform((val) => val.split(',')).pipe(z.array(z.string()).min(1, 'At least one connection ID is required')),
  encoding: z.enum(['base64', 'raw']).default('base64')
});

function parseBuffer(data: string, encoding: 'base64' | 'raw'): Buffer {
  switch (encoding) {
    case 'base64':
      return Buffer.from(data, 'base64');
    case 'raw':
      return Buffer.from(data, 'binary');
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

export function createApp(testConfig?: ProxyConfig & { readonly apiPort?: number }) {
  const config = testConfig || getConfig();
  const app = new Hono()
  app.use(logger())

  const proxy = new RedisProxy(config);
  proxy.start().catch(console.error);

  app.get('/', (c) => {
    return c.text('Hono server is running. The Redis Proxy is managed separately.')
  })

  app.get('/stats', (c) => {
    return c.json(proxy.getStats());
  });

  app.get('/connections', (c) => {
    return c.json({ connectionIds: proxy.getActiveConnectionIds() });
  });

  app.post('/send-to-client/:connectionId',
    zValidator('param', paramSchema),
    zValidator('query', encodingSchema),
    async (c) => {
      const { connectionId } = c.req.valid('param');
      const { encoding } = c.req.valid('query');
      const data = await c.req.text();

      const buffer = parseBuffer(data, encoding);
      const result = proxy.sendToClient(connectionId, buffer);
      return c.json(result);
    }
  );

  app.post('/send-to-clients',
    zValidator('query', connectionIdsQuerySchema),
    async (c) => {
      const { connectionIds, encoding } = c.req.valid('query');
      const data = await c.req.text();

      const buffer = parseBuffer(data, encoding);
      const results = proxy.sendToClients(connectionIds, buffer);
      return c.json({ results });
    }
  );

  app.post('/send-to-all-clients',
    zValidator('query', encodingSchema),
    async (c) => {
      const { encoding } = c.req.valid('query');
      const data = await c.req.text();

      const buffer = parseBuffer(data, encoding);
      const results = proxy.sendToAllClients(buffer);
      return c.json({ results });
    }
  );

  app.delete('/connections/:id', (c) => {
    const connectionId = c.req.param('id');
    const success = proxy.closeConnection(connectionId);
    return c.json({ success, connectionId });
  });

  return { app, proxy, config };
}
