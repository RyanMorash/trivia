#!/usr/bin/env node
// Emulates a hardware buzzer for protocol testing, over both transports.
//
//   node scripts/fake-buzzer.mjs <sessionCode> <buzzerId> [count] [jitterMs]
//
// Fires `count` buzzes (default 1) alternating HTTP and WebSocket, with
// random jitter up to `jitterMs` (default 300) between them.

import { io } from 'socket.io-client';

const [code, buzzerId, countArg, jitterArg] = process.argv.slice(2);
if (!code || !buzzerId) {
  console.error('usage: fake-buzzer.mjs <sessionCode> <buzzerId> [count] [jitterMs]');
  process.exit(1);
}
const SERVER = process.env.TRIVIA_SERVER ?? 'http://localhost:3001';
const count = Number(countArg ?? 1);
const jitter = Number(jitterArg ?? 300);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buzzHttp() {
  const res = await fetch(`${SERVER}/api/sessions/${code}/buzz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buzzerId, ts: Date.now() }),
  });
  console.log(`[http] ${buzzerId}:`, await res.json());
}

const socket = io(`${SERVER}/buzzers`, { auth: { code } });
const wsReady = new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', reject);
});

function buzzWs() {
  return new Promise((resolve) => {
    socket.timeout(3000).emit('buzz', { buzzerId, ts: Date.now() }, (err, res) => {
      console.log(`[ws]   ${buzzerId}:`, err ? 'timeout' : res);
      resolve();
    });
  });
}

try {
  await wsReady;
  for (let i = 0; i < count; i++) {
    await sleep(Math.random() * jitter);
    if (i % 2 === 0) await buzzHttp();
    else await buzzWs();
  }
} finally {
  socket.close();
}
