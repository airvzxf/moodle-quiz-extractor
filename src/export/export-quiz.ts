import { zipSync, strToU8, type Zippable } from 'fflate';
import type { QuizDocument } from '@/domain/types';
import { fetchAssets, planAssets, type FetchImage } from '@/export/assets';
import { renderMarkdown } from '@/export/markdown';

export interface ExportOptions {
  detailed: boolean;
  generatorVersion: string;
  /** Fecha ISO 8601 de la exportación. */
  exportedAt: string;
}

export interface ExportResult {
  /** "<slug>.zip" */
  fileName: string;
  zip: Uint8Array;
  /** El documento tal como se guardó en quiz.json (incluye avisos de imágenes). */
  document: QuizDocument;
}

/** Fecha fija de los archivos dentro del ZIP: mismo contenido → mismos bytes. */
const ZIP_MTIME = new Date(2000, 0, 1);

/**
 * Nombre base de los archivos: curso, unidad y título unidos por espacio,
 * sin acentos (NFD sin marcas), en minúsculas, cada racha fuera de [a-z0-9]
 * cambiada por '-', sin '-' al inicio ni al final, cortado a 80 caracteres
 * (y vuelto a limpiar de '-' final). Vacío → "cuestionario".
 */
export function slugFor(doc: QuizDocument): string {
  throw new Error('not implemented');
}

/**
 * Exporta el cuestionario a un ZIP con una carpeta "<slug>/" que contiene:
 *   quiz.md      renderMarkdown(document, …) con imagePaths de las imágenes descargadas
 *   quiz.json    JSON.stringify(document, null, 2) + "\n"
 *   quiz/<img>   cada imagen descargada
 * `document` = doc con los avisos de fetchAssets añadidos al final de warnings.
 * Todas las entradas usan ZIP_MTIME.
 */
export async function exportQuiz(
  doc: QuizDocument,
  fetchImage: FetchImage,
  opts: ExportOptions,
): Promise<ExportResult> {
  throw new Error('not implemented');
}
