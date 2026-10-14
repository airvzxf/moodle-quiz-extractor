// Servidor Moodle falso para las pruebas de humo. Sólo escucha en 127.0.0.1.
// - /mod/quiz/attempt.php?...&page=N  → fixture multipage-free-pN (exige cookie)
// - /pluginfile.php/...               → PNG (exige cookie)
// - sin cookie                        → 303 a /login/index.php
// - cualquier POST                    → 400 y queda registrado en `posts`
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

export const SESSION_COOKIE = { name: 'MoodleSession', value: 'smoke-session' };
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const fixture = (name) => readFileSync(join(process.cwd(), 'tests', 'fixtures', `${name}.html`), 'utf8');

export async function startFakeMoodle() {
  const log = { gets: [], posts: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') {
      log.posts.push(url.pathname);
      res.writeHead(400).end();
      return;
    }
    log.gets.push(url.pathname + url.search);
    const hasSession = (req.headers.cookie ?? '').includes(`${SESSION_COOKIE.name}=${SESSION_COOKIE.value}`);
    if (url.pathname === '/login/index.php') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><form id="login"><input name="username"><input name="password" type="password"></form></body></html>');
      return;
    }
    if (!hasSession) {
      res.writeHead(303, { location: '/login/index.php' }).end();
      return;
    }
    if (url.pathname === '/mod/quiz/attempt.php') {
      const page = url.searchParams.get('page') ?? '0';
      if (page !== '0' && page !== '1') {
        res.writeHead(404).end();
        return;
      }
      const html = fixture(`multipage-free-p${page}`).replaceAll('https://moodle.example.test', origin());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname.startsWith('/pluginfile.php/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  return {
    origin: origin(),
    attemptUrl: `${origin()}/mod/quiz/attempt.php?attempt=13963&cmid=11256`,
    log,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
