import type { ExportWarning, QuizDocument, QuizImage } from '@/domain/types';

export interface AssetPlan {
  url: string;
  /** Ruta dentro de la carpeta del ZIP, siempre "quiz/<nombre>". */
  path: string;
}

export interface FetchedAsset {
  path: string;
  bytes: Uint8Array;
}

/** Descarga una URL con la sesión de la persona. */
export type FetchImage = (url: string) => Promise<Response>;

/** Tamaño máximo aceptado por imagen. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Todas las imágenes del documento en orden: por pregunta, enunciado y luego opciones. */
export function documentImages(doc: QuizDocument): QuizImage[] {
  return doc.questions.flatMap((q) => [...q.images, ...q.choices.flatMap((c) => c.images)]);
}

/**
 * Asigna una ruta local a cada URL distinta, en orden de aparición.
 * Nombre = último segmento de la ruta de la URL, decodificado (si falla, tal
 * cual), con cada racha de caracteres fuera de [A-Za-z0-9._-] cambiada por '_'
 * ('imagen' si queda vacío). Si el nombre ya se usó: "<base>-2<ext>", "-3"…,
 * donde <ext> es desde el último '.' (si existe y no es el primer carácter).
 */
export function planAssets(doc: QuizDocument): AssetPlan[] {
  const plans: AssetPlan[] = [];
  const seenUrls = new Set<string>();
  const usedNames = new Set<string>();
  for (const image of documentImages(doc)) {
    if (seenUrls.has(image.url)) continue;
    seenUrls.add(image.url);
    const base = safeName(image.url);
    let name = base;
    for (let n = 2; usedNames.has(name); n++) name = withSuffix(base, n);
    usedNames.add(name);
    plans.push({ url: image.url, path: `quiz/${name}` });
  }
  return plans;
}

/**
 * Descarga las imágenes planificadas, una a la vez y en orden.
 * Sólo se piden URLs del mismo `origin`; el resto no se pide.
 * Una imagen se acepta si la respuesta es ok, su Content-Type empieza por
 * "image/" y pesa como máximo MAX_IMAGE_BYTES. Cada imagen no aceptada (o cuya
 * descarga lanza) produce {code:'image-not-downloaded', detail:url}.
 * Devuelve el mapa url → archivo sólo para las aceptadas.
 */
export async function fetchAssets(
  plans: AssetPlan[],
  origin: string,
  fetchImage: FetchImage,
): Promise<{ files: Map<string, FetchedAsset>; warnings: ExportWarning[] }> {
  const files = new Map<string, FetchedAsset>();
  const warnings: ExportWarning[] = [];
  for (const plan of plans) {
    let accepted = false;
    if (new URL(plan.url).origin === origin) {
      try {
        const response = await fetchImage(plan.url);
        const type = response.headers.get('content-type') ?? '';
        if (response.ok && type.toLowerCase().startsWith('image/')) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length <= MAX_IMAGE_BYTES) {
            files.set(plan.url, { path: plan.path, bytes });
            accepted = true;
          }
        }
      } catch {
        accepted = false;
      }
    }
    if (!accepted) warnings.push({ code: 'image-not-downloaded', detail: plan.url });
  }
  return { files, warnings };
}

function safeName(url: string): string {
  const last = new URL(url).pathname.split('/').pop() ?? '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  return decoded.replace(/[^A-Za-z0-9._-]+/g, '_') || 'imagen';
}

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}
