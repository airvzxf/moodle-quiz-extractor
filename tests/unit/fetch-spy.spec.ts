// tests/unit/fetch-spy.spec.ts

import { describe, it, expect, vi } from 'vitest';
import { installFetchSpy, type FetchLikeEnvironment } from '~/moodle/applicators/fetch-spy';

function makeEnv(): FetchLikeEnvironment & { calls: Array<unknown> } {
  const calls: Array<unknown> = [];
  const fetchImpl: typeof fetch = vi.fn(async (...args: unknown[]) => {
    calls.push(args);
    return new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    target: { fetch: fetchImpl },
    calls,
  };
}

describe('fetch-spy — pass-through paths', () => {
  it('allows GET requests unconditionally', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    await env.target.fetch('https://m.example.edu/pluginfile.php/123');
    expect(spy.blocked()).toBe(0);
    expect(env.calls.length).toBe(1);
  });

  it('allows POST to non-Moodle URLs', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    await env.target.fetch('https://other.example.org/api', { method: 'POST' });
    expect(spy.blocked()).toBe(0);
  });

  it('allows POST to Moodle URLs that do not target the attempt endpoint', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    await env.target.fetch('https://m.example.edu/mod/forum/post.php', { method: 'POST' });
    expect(spy.blocked()).toBe(0);
  });
});

describe('fetch-spy — blocking paths', () => {
  it('blocks POST to /mod/quiz/attempt.php?finishattempt=...', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    await expect(
      env.target.fetch(
        'https://m.example.edu/mod/quiz/attempt.php?attempt=1&finishattempt=1',
        { method: 'POST' },
      ),
    ).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
  });

  it('blocks POST to /mod/quiz/attempt.php?processattempt=...', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    await expect(
      env.target.fetch('https://m.example.edu/mod/quiz/attempt.php?processattempt=1', { method: 'POST' }),
    ).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
  });

  it('blocks PUT (any non-GET method) targeting the attempt endpoint', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    await expect(
      env.target.fetch('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1', { method: 'PUT' }),
    ).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
  });

  it('blocks when the URL is provided as a Request object', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    const req = new Request('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' });
    await expect(env.target.fetch(req)).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
  });
});

describe('fetch-spy — lifecycle', () => {
  it('disable() suppresses the block (re-entrant)', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    spy.disable();
    await env.target.fetch('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' });
    expect(spy.blocked()).toBe(0);
    spy.enable();
    await expect(
      env.target.fetch('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' }),
    ).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
  });

  it('uninstall() restores the original fetch', async () => {
    const env = makeEnv();
    const original = env.fetchImpl;
    const spy = installFetchSpy(env);
    spy.uninstall();
    expect(env.target.fetch).toBe(original);
  });

  it('counts every block in sequence', async () => {
    const env = makeEnv();
    const spy = installFetchSpy(env);
    for (let i = 0; i < 3; i++) {
      await expect(
        env.target.fetch(`https://m.example.edu/mod/quiz/attempt.php?finishattempt=${i}`, { method: 'POST' }),
      ).rejects.toThrow();
    }
    expect(spy.blocked()).toBe(3);
  });

  it('invokes onBlock with a descriptive reason', async () => {
    const env = makeEnv();
    const reasons: string[] = [];
    const spy = installFetchSpy(env, (reason) => reasons.push(reason));
    await expect(
      env.target.fetch('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' }),
    ).rejects.toThrow();
    expect(reasons[0]).toContain('blocked by fetch-spy');
    void spy;
  });
});