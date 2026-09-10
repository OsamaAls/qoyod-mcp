// A local fake Qoyod API for offline, process-level tests. Listens on 127.0.0.1 only.
//   const mock = await startMockQoyod({ keys: { 'fake-key-1': 'Alpha' } });  -> mock.base, mock.log, mock.close()
import http from 'node:http';

export async function startMockQoyod({ keys = {}, routes = {} } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const key = req.headers['api-key'];
      const path = url.pathname.replace(/^\/2\.0\//, '');
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      log.push({ method: req.method, path, key, query: Object.fromEntries(url.searchParams), body });
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      };
      if (!keys[key]) return send(401, { message: 'unauthorized' });
      const handler = routes[`${req.method} ${path}`];
      if (handler) {
        const r = handler({ key, company: keys[key], path, query: Object.fromEntries(url.searchParams), body });
        return send(r.status ?? 200, r.body ?? {});
      }
      if (req.method === 'GET') return send(200, { [path.split('/')[0]]: [{ id: 1, name: `${keys[key]} record` }] });
      return send(201, { created: true });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}/2.0`,
    log,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
