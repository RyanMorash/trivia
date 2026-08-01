import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { contentRouter } from './api/content.js';
import { sessionsRouter } from './api/sessions.js';
import { openDb } from './db/connection.js';
import { ContentRepo } from './db/repos/contentRepo.js';
import { EventRepo } from './db/repos/eventRepo.js';
import { SessionRepo } from './db/repos/sessionRepo.js';
import { EngineRegistry } from './game/registry.js';
import { createEmitter, setupSockets } from './sockets/io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerHandle {
  httpServer: http.Server;
  close(): Promise<void>;
}

export function createServer(opts: { dbPath: string; port?: number }): ServerHandle {
  const db = openDb(opts.dbPath);
  const content = new ContentRepo(db);
  const sessions = new SessionRepo(db);
  const events = new EventRepo(db);

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const httpServer = http.createServer(app);
  // Generous keep-alive: the default 5s window races client connection reuse
  // and surfaces as sporadic ECONNRESET on console/tablet API calls.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  // Same-origin by default — the server serves the built web app, and the Vite
  // dev server proxies /socket.io, so no CORS is normally needed. Cross-origin
  // setups can allow specific origins via TRIVIA_ALLOWED_ORIGINS=a,b (or * to
  // reflect any origin on a trusted event LAN).
  const allowedOrigins = process.env.TRIVIA_ALLOWED_ORIGINS;
  const io = new Server(
    httpServer,
    allowedOrigins
      ? { cors: { origin: allowedOrigins === '*' ? true : allowedOrigins.split(',') } }
      : {},
  );

  const registry = new EngineRegistry({ content, sessions, events, emitter: createEmitter(io) });
  registry.recoverAll();

  setupSockets(io, registry, sessions);

  app.use('/api', contentRouter(content));
  app.use('/api', sessionsRouter(sessions, content, registry));

  // Production: serve the built web app from a single process.
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return {
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        io.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  const dbPath = process.env.TRIVIA_DB ?? path.resolve(__dirname, '../../data/trivia.db');
  const { httpServer } = createServer({ dbPath, port });
  httpServer.listen(port, () => {
    console.log(`trivia server listening on http://0.0.0.0:${port} (db: ${dbPath})`);
  });
}
