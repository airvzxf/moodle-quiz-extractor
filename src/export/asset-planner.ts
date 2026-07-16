// src/export/asset-planner.ts
//
// Pure planner: takes a QuizDocument (or any list of source URLs discovered
// during parsing) and produces an `AssetPlan` with deduplication, MIME
// validation, naming, and a stable `localPath` for each entry. No fetch, no
// DOM, no browser APIs — fully unit-testable.
//
// MIME allowlist mirrors the types Moodle serves from `pluginfile.php` for
// quiz prompts. Anything outside the list is blocked (MQX-ASSET-201).
//
// Magic bytes are validated when the caller hands us the actual bytes; this
// module exposes `validateMagicBytes()` for the fetcher to call after the
// download completes.

import { MQX, type MqxCode } from '~/diagnostics/codes';

export const ASSET_MIME_ALLOWLIST = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type AllowedMime = (typeof ASSET_MIME_ALLOWLIST)[number];

export interface AssetEntry {
  /** Original URL on the Moodle origin. */
  readonly sourceUrl: string;
  /** Detected or server-declared MIME. */
  readonly mime: string;
  /** SHA-256 of the bytes (hex). Undefined until the fetcher computes it. */
  readonly sha256?: string;
  /** Bytes downloaded. Undefined until the fetcher returns. */
  readonly bytes?: Uint8Array;
  /** Local path inside the ZIP, e.g. "quiz/q2-a1b2c3d4.png". */
  readonly localPath: string;
  /** Resolved question number(s) that reference this asset. */
  readonly questionNumbers: ReadonlyArray<number>;
  /** Status assigned by the fetcher. */
  readonly status: 'pending' | 'downloaded' | 'failed' | 'skipped';
  /** Failure reason, when status !== 'downloaded'. */
  readonly failureCode?: MqxCode;
}

export interface AssetPlanInput {
  readonly sourceUrl: string;
  readonly mime?: string;
  /** Question numbers that reference this asset. */
  readonly questionNumbers: ReadonlyArray<number>;
}

export interface AssetPlan {
  readonly entries: ReadonlyArray<AssetEntry>;
  readonly warnings: ReadonlyArray<{ code: MqxCode; message: string }>;
}

export interface PlannerOptions {
  /** Folder inside the ZIP that holds assets. Defaults to "quiz". */
  readonly assetDir?: string;
  /** Maximum number of assets to plan; the rest are flagged as skipped. */
  readonly maxAssets?: number;
}

const DEFAULT_OPTIONS: Required<PlannerOptions> = {
  assetDir: 'quiz',
  maxAssets: 64,
};

/** MIME extension fallback table. Only used when the URL has no extension. */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Reverse mapping: extension -> MIME. Used when the caller doesn't supply
 *  a `Content-Type` and we have to guess from the URL path. */
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Best-effort MIME inference from a URL. Returns null when the extension
 *  is unknown. The planner falls back to this when neither the caller nor
 *  the server provided a Content-Type. */
export function inferMimeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0 || dot >= last.length - 1) return null;
    const ext = last.slice(dot + 1).toLowerCase();
    return EXT_TO_MIME[ext] ?? null;
  } catch {
    return null;
  }
}

/** Magic bytes per MIME. Caller passes the downloaded bytes; the planner
 *  verifies the leading 4–12 bytes match. */
export function validateMagicBytes(
  bytes: Uint8Array,
  mime: string,
): { ok: true } | { ok: false; expected: string; got: string } {
  if (bytes.length < 4) {
    return { ok: false, expected: mime, got: 'too-short' };
  }
  const head = Array.from(bytes.slice(0, 12));
  const hex = head.map((b) => b.toString(16).padStart(2, '0')).join('');

  switch (mime) {
    case 'image/png':
      // 89 50 4E 47 0D 0A 1A 0A
      return hex.startsWith('89504e470d0a1a0a')
        ? { ok: true }
        : { ok: false, expected: '89504e47…', got: hex.slice(0, 16) };
    case 'image/jpeg':
      // FF D8 FF
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
        ? { ok: true }
        : { ok: false, expected: 'ffd8ff…', got: hex.slice(0, 16) };
    case 'image/gif':
      // 47 49 46 38 (GIF8)
      return head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46
        ? { ok: true }
        : { ok: false, expected: '474946…', got: hex.slice(0, 16) };
    case 'image/webp': {
      // 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 (RIFF....WEBP)
      if (head.length < 12) {
        return { ok: false, expected: 'riff…webp', got: hex.slice(0, 16) };
      }
      const riff =
        head[0] === 0x52 &&
        head[1] === 0x49 &&
        head[2] === 0x46 &&
        head[3] === 0x46;
      const webp =
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
      return riff && webp
        ? { ok: true }
        : { ok: false, expected: 'riff…webp', got: hex.slice(0, 24) };
    }
    default:
      return { ok: false, expected: 'whitelisted-mime', got: mime };
  }
}

/** Compute a stable SHA-256 of the input bytes (hex). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    // Copy into a fresh ArrayBuffer so the type narrows to ArrayBuffer (the
    // subtle.digest signature is `BufferSource` but TS infers the broader
    // `Uint8Array<ArrayBufferLike>` which doesn't satisfy `ArrayBuffer`).
    const buf = new Uint8Array(bytes.byteLength);
    buf.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

/** Resolve a `sourceUrl` to a normalized absolute URL. */
export function absolutizeUrl(
  base: string,
  maybeRelative: string,
): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

/** Strip the query string and fragment from a URL (Moodle uses them to carry
 *  tokens / attempt ids / cmids, which the redactor must catch). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function pickMime(
  input: AssetPlanInput,
  urlMime: string | undefined,
): string | null {
  const declared = input.mime ?? urlMime ?? '';
  const lower = declared.toLowerCase().split(';')[0]?.trim() ?? '';
  if ((ASSET_MIME_ALLOWLIST as ReadonlyArray<string>).includes(lower)) {
    return lower;
  }
  // Fallback: infer from the URL extension. This is best-effort and only
  // activates when the caller did NOT supply a Content-Type at all.
  if (!input.mime && !urlMime) {
    return inferMimeFromUrl(input.sourceUrl);
  }
  return null;
}

function extFromUrl(url: string, mime: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    if (dot > 0 && dot < last.length - 1) {
      const ext = last.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
    }
  } catch {
    /* fall through */
  }
  return MIME_TO_EXT[mime] ?? 'bin';
}

function dedupeKey(url: string, mime: string): string {
  return `${canonicalUrl(url)}|${mime}`;
}

/**
 * Build an `AssetPlan` from the URLs discovered while parsing the document.
 *
 * Algorithm:
 *  1. Group references by `(canonicalUrl, mime)` to deduplicate.
 *  2. Assign each unique entry a `localPath` of the form
 *     `<assetDir>/<firstQuestionNumber>-<first8sha256hex>.<ext>`.
 *  3. Reject entries whose MIME is not in the allowlist (MQX-ASSET-201).
 *  4. Cap at `maxAssets`; the remainder are flagged `skipped`.
 *  5. The hash slot is filled later by the fetcher once bytes arrive; until
 *     then we use a placeholder derived from the URL so tests stay stable.
 */
export function buildAssetPlan(
  inputs: ReadonlyArray<AssetPlanInput>,
  opts: PlannerOptions = {},
): AssetPlan {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const groups = new Map<
    string,
    {
      sourceUrl: string;
      mime: string;
      questionNumbers: Set<number>;
    }
  >();
  const warnings: { code: MqxCode; message: string }[] = [];

  for (const input of inputs) {
    const url = canonicalUrl(input.sourceUrl);
    const lower = (input.mime ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
    const mime = pickMime(input, lower);
    if (!mime) {
      warnings.push({
        code: MQX.ASSET_MIME_DENIED,
        message: `MIME not in allowlist for ${url}: ${input.mime ?? '<unknown>'}`,
      });
      continue;
    }
    const key = dedupeKey(url, mime);
    const existing = groups.get(key);
    if (existing) {
      for (const n of input.questionNumbers) existing.questionNumbers.add(n);
    } else {
      groups.set(key, {
        sourceUrl: url,
        mime,
        questionNumbers: new Set(input.questionNumbers),
      });
    }
  }

  const sorted = Array.from(groups.values()).sort((a, b) => {
    const aMin = Math.min(...a.questionNumbers);
    const bMin = Math.min(...b.questionNumbers);
    return aMin - bMin || a.sourceUrl.localeCompare(b.sourceUrl);
  });

  const entries: AssetEntry[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const g = sorted[i]!;
    const questionNumbers = Array.from(g.questionNumbers).sort((a, b) => a - b);
    const firstQ = questionNumbers[0] ?? 0;
    const ext = extFromUrl(g.sourceUrl, g.mime);
    // We use a deterministic placeholder for the hash slot until the fetcher
    // fills it in. This keeps the localPath stable across re-plans of the
    // same QuizDocument, so the Markdown renderer doesn't churn between
    // previews.
    const placeholderHash = pseudoHashFallback(`${g.sourceUrl}|${g.mime}`);
    const localPath = `${options.assetDir}/q${firstQ}-${placeholderHash}.${ext}`;

    if (entries.length >= options.maxAssets) {
      warnings.push({
        code: MQX.ASSET_MIME_DENIED,
        message: `maxAssets reached (${options.maxAssets}); ${g.sourceUrl} skipped`,
      });
      continue;
    }

    entries.push({
      sourceUrl: g.sourceUrl,
      mime: g.mime,
      localPath,
      questionNumbers,
      status: 'pending',
    });
  }

  return { entries, warnings };
}

/** Tiny non-cryptographic hash used as a stable placeholder. Deterministic
 *  across runs so the same `sourceUrl|mime` always yields the same
 *  `localPath`. Replaced by the real SHA-256 once bytes are fetched. */
export function pseudoHashFallback(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  for (let i = 0; i < seed.length; i += 1) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (part1 + part2).slice(0, 8);
}