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
  throw new Error('not implemented');
}

/**
 * Asigna una ruta local a cada URL distinta, en orden de aparición.
 * Nombre = último segmento de la ruta de la URL, decodificado (si falla, tal
 * cual), con cada racha de caracteres fuera de [A-Za-z0-9._-] cambiada por '_'
 * ('imagen' si queda vacío). Si el nombre ya se usó: "<base>-2<ext>", "-3"…,
 * donde <ext> es desde el último '.' (si existe y no es el primer carácter).
 */
export function planAssets(doc: QuizDocument): AssetPlan[] {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}
