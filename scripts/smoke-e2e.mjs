#!/usr/bin/env node
// Full-stack smoke test: boots the real server, seeds content over REST,
// connects all four roles over Socket.IO, plays a board clue with HTTP
// buzzes, then SIGKILLs the server mid-game and verifies recovery.
//
//   node scripts/smoke-e2e.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-smoke-')), 'smoke.db');
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

let serverProc = null;
let failures = 0;

const check = (name, cond) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, attempt = 0) {
  try {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch (err) {
    // Keep-alive close race: the server may close a pooled connection just as
    // we reuse it. One retry on a fresh connection is safe for test seeding.
    if (attempt === 0 && err.cause?.code === 'ECONNRESET') {
      return api(method, url, body, 1);
    }
    throw err;
  }
}

function startServer() {
  serverProc = spawn('npx', ['tsx', 'server/src/index.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT), TRIVIA_DB: dbPath },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  serverProc.stdout.on('data', () => {});
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/question-sets`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('server never became ready');
}

function connect(auth) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth, transports: ['websocket'] });
    const state = { socket, snapshot: null };
    socket.on('state:snapshot', (snap) => {
      state.snapshot = snap;
    });
    socket.on('connect', () => resolve(state));
    socket.on('connect_error', (err) => reject(new Error(`${auth.role}: ${err.message}`)));
  });
}

const send = (state, cmd) =>
  new Promise((resolve) => state.socket.emit('cmd', cmd, resolve));

const waitFor = async (state, pred, label) => {
  for (let i = 0; i < 40; i++) {
    if (state.snapshot && pred(state.snapshot)) return true;
    await sleep(100);
  }
  console.log(`  (timeout waiting for: ${label})`);
  return false;
};

try {
  console.log('— boot');
  startServer();
  await waitReady();
  check('server boots and serves the API', true);

  console.log('— seed content');
  const set = await api('POST', '/api/question-sets/import', {
    name: 'Smoke Set',
    categories: [
      { name: 'History', questions: [{ prompt: 'First US president?', answer: 'Washington' }, { prompt: 'Year WW2 ended?', answer: '1945' }] },
      { name: 'Science', questions: [{ prompt: 'H2O is?', answer: 'Water' }, { prompt: 'Speed of light?', answer: '299,792 km/s' }] },
    ],
  });
  const detail = await api('GET', `/api/question-sets/${set.id}`);
  const catIds = detail.categories.map((c) => c.id);
  const game = await api('POST', '/api/games', { name: 'Smoke Game' });
  await api('POST', `/api/games/${game.id}/rounds`, {
    sortOrder: 0,
    title: 'Board',
    config: { type: 'board', questionSetId: set.id, categoryIds: catIds, values: [100, 200], wrongAnswerPenalty: true },
  });
  check('content seeded via import + composer API', Array.isArray(catIds) && catIds.length === 2);

  console.log('— session setup');
  const session = await api('POST', '/api/sessions', { gameId: game.id });
  const srq = `key=${session.showrunnerKey}`;
  const teamA = await api('POST', `/api/sessions/${session.code}/teams?${srq}`, { name: 'Alpha' });
  const teamB = await api('POST', `/api/sessions/${session.code}/teams?${srq}`, { name: 'Bravo' });
  await api('PUT', `/api/sessions/${session.code}/buzzers?${srq}`, { buzzerId: 'B1', teamId: teamA.id });
  await api('PUT', `/api/sessions/${session.code}/buzzers?${srq}`, { buzzerId: 'B2', teamId: teamB.id });
  check('session, teams, and buzzer mappings created', Boolean(session.code && teamA.id && teamB.id));

  console.log('— connect all four roles');
  const sr = await connect({ code: session.code, role: 'showrunner', key: session.showrunnerKey });
  const host = await connect({ code: session.code, role: 'host', key: session.hostKey });
  const audience = await connect({ code: session.code, role: 'audience' });
  const teamTab = await connect({ code: session.code, role: 'competitor', teamId: teamA.id });
  check('all roles authenticated', true);
  const badKey = await new Promise((resolve) => {
    const s = io(BASE, {
      auth: { code: session.code, role: 'showrunner', key: 'wrong' },
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => {
      s.close();
      resolve(false);
    });
    s.on('connect_error', () => {
      s.close();
      resolve(true);
    });
  });
  check('bad showrunner key is rejected', badKey);

  console.log('— play a board clue');
  check('startGame ok', (await send(sr, { type: 'startGame' })).ok);
  check('startRound ok', (await send(sr, { type: 'startRound', roundIndex: 0 })).ok);
  check('intro continue ok', (await send(host, { type: 'continue' })).ok);
  await waitFor(host, (s) => s.round?.phase === 'idle', 'idle');
  const qid = host.snapshot.round.board[0].cells[0].questionId;
  check('selectClue ok', (await send(host, { type: 'selectClue', questionId: qid })).ok);
  await waitFor(audience, (s) => s.round?.phase === 'clue-shown', 'clue-shown (audience)');
  await waitFor(teamTab, (s) => s.round?.phase === 'clue-shown', 'clue-shown (competitor)');
  check('host sees the answer', host.snapshot.round.currentClue.answer === 'Washington');
  check('audience does NOT see the answer', audience.snapshot.round.currentClue.answer === null);
  check('competitor does NOT see the answer', teamTab.snapshot.round.currentClue.answer === null);

  check('openBuzzers ok', (await send(host, { type: 'openBuzzers' })).ok);
  const buzz1 = await api('POST', `/api/sessions/${session.code}/buzz`, { buzzerId: 'B2' });
  check('HTTP buzz accepted first', buzz1.accepted && buzz1.order === 1);
  const buzz2 = await api('POST', `/api/sessions/${session.code}/buzz`, { buzzerId: 'B1' });
  check('second buzz queued', buzz2.accepted && buzz2.order === 2);
  const buzzDup = await api('POST', `/api/sessions/${session.code}/buzz`, { buzzerId: 'B2' });
  check('duplicate buzz rejected', !buzzDup.accepted && buzzDup.reason === 'duplicate');
  const buzzGhost = await api('POST', `/api/sessions/${session.code}/buzz`, { buzzerId: 'ghost' });
  check('unmapped buzzer rejected', !buzzGhost.accepted && buzzGhost.reason === 'unmapped');

  await waitFor(audience, (s) => s.buzz?.answeringTeamId === teamB.id, 'Bravo answering');
  check('audience sees Bravo answering', audience.snapshot.buzz.answeringTeamId === teamB.id);

  check('judge wrong ok', (await send(host, { type: 'judge', correct: false })).ok);
  await waitFor(audience, (s) => s.teams.find((t) => t.id === teamB.id)?.score === -100, 'penalty applied');
  check('Bravo penalized -100, race reopened', audience.snapshot.round.phase === 'buzzing-open');
  const buzz3 = await api('POST', `/api/sessions/${session.code}/buzz`, { buzzerId: 'B1' });
  check('Alpha wins the reopened race', buzz3.accepted && buzz3.order === 1);
  check('judge correct ok', (await send(host, { type: 'judge', correct: true })).ok);
  await waitFor(audience, (s) => s.round?.phase === 'answer-reveal', 'answer-reveal');
  check('answer revealed to audience', audience.snapshot.round.revealedAnswer === 'Washington');
  check('Alpha scored +100', audience.snapshot.teams.find((t) => t.id === teamA.id).score === 100);

  console.log('— kill server mid-game and recover');
  for (const s of [sr, host, audience, teamTab]) s.socket.close();
  serverProc.kill('SIGKILL');
  await sleep(300);
  startServer();
  await waitReady();
  const revived = await connect({ code: session.code, role: 'host', key: session.hostKey });
  await waitFor(revived, (s) => s.status === 'live', 'revived snapshot');
  check('status recovered as live', revived.snapshot.status === 'live');
  check('phase recovered (answer-reveal)', revived.snapshot.round.phase === 'answer-reveal');
  check('scores recovered', revived.snapshot.teams.find((t) => t.id === teamA.id).score === 100);
  check('continue works after recovery', (await send(revived, { type: 'continue' })).ok);
  await waitFor(revived, (s) => s.round?.phase === 'idle', 'idle after recovery');
  check('clue marked used after recovery', revived.snapshot.round.board[0].cells[0].used === true);
  revived.socket.close();

  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
  serverProc?.kill('SIGKILL');
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('\nSMOKE ERROR:', err);
  serverProc?.kill('SIGKILL');
  process.exit(1);
}
