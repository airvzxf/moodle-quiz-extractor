// Tipos del autollenado. Sólo tipos: sin lógica.

/** Una línea válida de la lista de respuestas. */
export interface AnswerEntry {
  /** Número visible de la pregunta (>= 1). */
  number: number;
  /** Letras en minúscula, sin repetir, en el orden en que aparecen. Nunca vacío. */
  letters: string[];
  /** Línea de origen (desde 1). */
  line: number;
}

export interface LineError {
  line: number;
  /** La línea original recortada. */
  text: string;
  /** 'format': no sigue el formato; 'duplicate': el número ya apareció antes. */
  reason: 'format' | 'duplicate';
}

export interface ParsedAnswers {
  entries: AnswerEntry[];
  errors: LineError[];
}

/** Lo que hay que hacer en una pregunta de la página actual. */
export interface FillStep {
  number: number;
  kind: 'single_choice' | 'multiple_choice';
  /** ids de los <input> que deben quedar marcados (orden de las opciones). */
  check: string[];
  /** ids de los <input> que deben quedar desmarcados (sólo multiple_choice; orden de las opciones). */
  uncheck: string[];
}

export type FillIssueReason =
  | 'other-page'
  | 'not-in-quiz'
  | 'unsupported'
  | 'unknown-letter'
  | 'too-many-letters';

export interface FillIssue {
  number: number;
  reason: FillIssueReason;
  /** Sólo con 'other-page': página (desde 0) donde está la pregunta. */
  page?: number;
  /** Sólo con 'unknown-letter': la primera letra que no existe. */
  letter?: string;
}

export interface FillPlan {
  /** Ordenados por número de pregunta. */
  steps: FillStep[];
  /** Ordenados por número de pregunta. */
  issues: FillIssue[];
}

export interface ApplyFailure {
  number: number;
  reason: 'missing-input' | 'not-confirmed';
}

export interface ApplyReport {
  /** Números aplicados y confirmados, en el orden del plan. */
  applied: number[];
  failed: ApplyFailure[];
}
