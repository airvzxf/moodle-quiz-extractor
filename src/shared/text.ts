/** Colapsa cualquier secuencia de espacios (incluido &nbsp;) en uno y recorta. */
export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Resuelve `raw` contra `base` y devuelve la URL absoluta SIN query ni
 * fragmento. Devuelve null si no es http(s) o no se puede interpretar.
 */
export function cleanUrl(raw: string | null, base: string): string | null {
  if (raw === null || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.search = '';
  url.hash = '';
  return url.toString();
}
