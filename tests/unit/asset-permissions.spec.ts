// tests/unit/asset-permissions.spec.ts
//
// Unit tests for the host-permission helpers. The runtime behaviour with a
// real browser API is covered by the integration test suite; here we focus
// on the pure parts: `originPatternFor` resolution and the fallbacks when
// the browser API is unavailable.

import { describe, it, expect } from 'vitest';
import {
  originPatternFor,
  probeAssetPermission,
  requestAssetPermission,
  type BrowserApi,
} from '~/permissions/asset-permissions';

describe('originPatternFor', () => {
  it('returns the canonical scheme://host/* pattern for a normal URL', () => {
    expect(originPatternFor('https://moodle.example.edu/mod/quiz/attempt.php?attempt=42'))
      .toBe('https://moodle.example.edu/*');
  });

  it('preserves non-default ports', () => {
    expect(originPatternFor('http://localhost:8080/mod/quiz/attempt.php'))
      .toBe('http://localhost:8080/*');
  });

  it('returns an empty string for non-URL inputs', () => {
    expect(originPatternFor('not-a-url')).toBe('');
    expect(originPatternFor('')).toBe('');
  });
});

describe('probeAssetPermission', () => {
  it('returns skipped=true when no browser API is available', async () => {
    const result = await probeAssetPermission('https://moodle.example.edu/x', {});
    expect(result).toEqual({
      originPattern: '',
      alreadyGranted: false,
      granted: false,
      skipped: true,
    });
  });

  it('returns skipped=true when origin pattern cannot be derived', async () => {
    const result = await probeAssetPermission('not-a-url', {});
    expect(result.originPattern).toBe('');
    expect(result.skipped).toBe(true);
  });

  it('reports alreadyGranted=true when the browser API confirms the origin', async () => {
    const api: BrowserApi = {
      permissions: {
        contains: async () => true,
        request: async () => true,
      },
    };
    const result = await probeAssetPermission('https://moodle.example.edu/x', api);
    expect(result.originPattern).toBe('https://moodle.example.edu/*');
    expect(result.alreadyGranted).toBe(true);
    expect(result.granted).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('requestAssetPermission', () => {
  it('returns granted=false when the browser API rejects the prompt', async () => {
    const api: BrowserApi = {
      permissions: {
        contains: async () => false,
        request: async () => false,
      },
    };
    const result = await requestAssetPermission('https://moodle.example.edu/x', api);
    expect(result.originPattern).toBe('https://moodle.example.edu/*');
    expect(result.granted).toBe(false);
    expect(result.alreadyGranted).toBe(false);
    expect(result.skipped).toBe(false);
  });

  it('returns granted=true and alreadyGranted=true when the user accepts', async () => {
    const api: BrowserApi = {
      permissions: {
        contains: async () => false,
        request: async () => true,
      },
    };
    const result = await requestAssetPermission('https://moodle.example.edu/x', api);
    expect(result.granted).toBe(true);
    expect(result.alreadyGranted).toBe(true);
  });

  it('falls back to skipped=true when the runtime lacks permissions.request', async () => {
    const result = await requestAssetPermission('https://moodle.example.edu/x', {});
    expect(result.skipped).toBe(true);
    expect(result.granted).toBe(false);
  });
});