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
  const io = new Server(httpServer, {
    cors: { origin: true },
  });

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
