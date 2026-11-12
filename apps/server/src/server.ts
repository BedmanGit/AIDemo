import 'dotenv/config';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { attachSession } from './session';

const port = Number(process.env.PORT ?? 3001);
const server = createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({
      ok: true,
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key'),
      searchConfigured: Boolean(process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY !== 'your_tavily_api_key'),
    }));
    return;
  }
  response.writeHead(404).end();
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
server.on('upgrade', (request, socket, head) => {
  let origin: URL;
  try { origin = new URL(request.headers.origin ?? ''); } catch { socket.destroy(); return; }
  if (request.url !== '/api/live' || origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || Number(origin.port) < 5173 || Number(origin.port) > 5190) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => attachSession(client, process.env.GEMINI_API_KEY, process.env.TAVILY_API_KEY));
});
server.listen(port, '127.0.0.1', () => console.log(`Voice server listening on 127.0.0.1:${port}`));