// tests/unit/asset-planner.spec.ts
import { describe, it, expect } from 'vitest';
import {
  ASSET_MIME_ALLOWLIST,
  buildAssetPlan,
  canonicalUrl,
  pseudoHashFallback,
  validateMagicBytes,
} from '~/export/asset-planner';
import { MQX } from '~/diagnostics/codes';

// pseudoHashFallback is re-exported only for testing the placeholder helper.
void pseudoHashFallback;

const PNG_1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const JPEG_HDR = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_HDR = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_HDR = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x10, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const FAKE_BYTES = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

describe('AssetPlanner — magic bytes', () => {
  it('accepts a real PNG header', () => {
    expect(validateMagicBytes(PNG_1x1, 'image/png')).toEqual({ ok: true });
  });
  it('accepts a real JPEG header', () => {
    expect(validateMagicBytes(JPEG_HDR, 'image/jpeg')).toEqual({ ok: true });
  });
  it('accepts a real GIF header', () => {
    expect(validateMagicBytes(GIF_HDR, 'image/gif')).toEqual({ ok: true });
  });
  it('accepts a real WebP header', () => {
    expect(validateMagicBytes(WEBP_HDR, 'image/webp')).toEqual({ ok: true });
  });
  it('rejects bytes that do not match the declared MIME', () => {
    const r = validateMagicBytes(FAKE_BYTES, 'image/png');
    expect(r.ok).toBe(false);
  });
  it('rejects bytes that are too short', () => {
    const r = validateMagicBytes(Uint8Array.from([1, 2]), 'image/png');
    expect(r.ok).toBe(false);
  });
  it('rejects an unknown MIME', () => {
    const r = validateMagicBytes(PNG_1x1, 'application/x-msdos-program');
    expect(r.ok).toBe(false);
  });
});

describe('AssetPlanner — canonicalUrl', () => {
  it('strips query string and fragment', () => {
    expect(
      canonicalUrl('https://moodle.example/pluginfile.php/123/foo.png?token=abc#x'),
    ).toBe('https://moodle.example/pluginfile.php/123/foo.png');
  });
  it('returns the original when parsing fails', () => {
    expect(canonicalUrl('not a url')).toBe('not a url');
  });
});

describe('AssetPlanner — buildAssetPlan', () => {
  it('returns an empty plan when given no inputs', () => {
    const plan = buildAssetPlan([]);
    expect(plan.entries).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('creates one entry per (canonicalUrl, mime) pair', () => {
    const plan = buildAssetPlan([
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/1/a.png',
        mime: 'image/png',
        questionNumbers: [1],
      },
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/1/a.png',
        mime: 'image/png',
        questionNumbers: [2],
      },
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/2/b.jpg',
        mime: 'image/jpeg',
        questionNumbers: [3],
      },
    ]);
    expect(plan.entries).toHaveLength(2);
    const first = plan.entries[0]!;
    expect(first.questionNumbers).toEqual([1, 2]);
    expect(first.mime).toBe('image/png');
    expect(first.status).toBe('pending');
  });

  it('strips the query string before deduplicating (tokenized URLs collapse)', () => {
    const plan = buildAssetPlan([
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/1/a.png?token=ABC',
        mime: 'image/png',
        questionNumbers: [1],
      },
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/1/a.png?token=DEF',
        mime: 'image/png',
        questionNumbers: [2],
      },
    ]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.sourceUrl).toBe(
      'https://moodle.example/pluginfile.php/1/a.png',
    );
  });

  it('flags an unsupported MIME with MQX-ASSET-201', () => {
    const plan = buildAssetPlan([
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/x.svg',
        mime: 'image/svg+xml',
        questionNumbers: [1],
      },
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]?.code).toBe(MQX.ASSET_MIME_DENIED);
  });

  it('flags an unknown MIME when not declared', () => {
    const plan = buildAssetPlan([
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/x.bin',
        questionNumbers: [1],
      },
    ]);
    expect(plan.entries).toEqual([]);
    expect(plan.warnings[0]?.code).toBe(MQX.ASSET_MIME_DENIED);
  });

  it('respects the assetDir option', () => {
    const plan = buildAssetPlan(
      [
        {
          sourceUrl: 'https://moodle.example/pluginfile.php/1/a.png',
          mime: 'image/png',
          questionNumbers: [1],
        },
      ],
      { assetDir: 'images' },
    );
    expect(plan.entries[0]?.localPath.startsWith('images/q1-')).toBe(true);
  });

  it('caps the number of entries at maxAssets and warns the rest', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      sourceUrl: `https://moodle.example/pluginfile.php/${i}/img.png`,
      mime: 'image/png' as const,
      questionNumbers: [i + 1],
    }));
    const plan = buildAssetPlan(inputs, { maxAssets: 2 });
    expect(plan.entries).toHaveLength(2);
    expect(plan.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the four allowlisted MIME types', () => {
    expect(ASSET_MIME_ALLOWLIST).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]);
  });

  it('produces a stable localPath across re-plans (no churn)', () => {
    const inputs = [
      {
        sourceUrl: 'https://moodle.example/pluginfile.php/1/foo.png',
        mime: 'image/png',
        questionNumbers: [2],
      },
    ];
    const a = buildAssetPlan(inputs).entries[0]?.localPath;
    const b = buildAssetPlan(inputs).entries[0]?.localPath;
    expect(a).toBe(b);
    expect(a).toMatch(/^quiz\/q2-[0-9a-f]{8}\.png$/);
  });
});