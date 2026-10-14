// Modelo de datos compartido por todas las capas. Sólo tipos: sin lógica.
//
// Regla: el modelo guarda DATOS deterministas y comparables. Los textos para
// la persona (Markdown, mensajes del popup) se construyen al presentarlos.

/** Tipo de pregunta según los controles que contiene (no según la clase CSS). */
export type QuestionKind = 'single_choice' | 'multiple_choice' | 'unsupported';

/** Imagen referenciada por una pregunta u opción. */
export interface QuizImage {
  /** URL absoluta, SIN query ni fragmento (nunca lleva sesskey ni tokens). */
  url: string;
  /** Texto alternativo tal como aparece en la página ('' si no tiene). */
  alt: string;
}

export interface Choice {
  /** Letra en minúscula: la de `.answernumber` o, si no existe, a, b, c… por orden. */
  letter: string;
  /** Texto visible de la opción con espacios normalizados ('' si sólo tiene imagen). */
  text: string;
  /** true si el control está marcado en la página exportada. */
  selected: boolean;
  /** `id` del <input> en la página (p. ej. "q13963:2_answer1"). */
  inputId: string;
  images: QuizImage[];
}

export interface Question {
  /** Número visible (`.qno`). Nunca el slot. */
  number: number;
  /** Slot de Moodle: último segmento del id "question-<uso>-<slot>". */
  slot: number;
  /** Página del intento (0 = primera), tal como la usa Moodle. */
  page: number;
  kind: QuestionKind;
  /** Primera clase después de `que` (p. ej. "multichoice", "truefalse", "shortanswer"). */
  moodleType: string;
  /** Enunciado: textContent de `.qtext` con espacios normalizados. */
  text: string;
  /** Texto de `legend.prompt` sin el número oculto (p. ej. "Seleccione una:"), o null. */
  instruction: string | null;
  /** Texto de `.info .state` (p. ej. "Sin responder aún"), o null. */
  state: string | null;
  /** Texto de `.info .grade` (p. ej. "Puntaje de 10.00"), o null. */
  grade: string | null;
  /** Vacío cuando kind === 'unsupported'. */
  choices: Choice[];
  /** Imágenes del enunciado, en orden de aparición. */
  images: QuizImage[];
}

/** Pregunta según el bloque de navegación (existe aunque esté en otra página). */
export interface NavEntry {
  number: number;
  page: number;
}

export interface Navigation {
  /** Una entrada por pregunta numerada, ordenadas por número. */
  entries: NavEntry[];
  /** Páginas distintas, ordenadas ascendentemente. Nunca vacío si hay entradas. */
  pages: number[];
  /** Página que se está mostrando (input name="thispage"). */
  currentPage: number;
  /** 'free' si todos los botones tienen la clase `free`; 'sequential' si ninguno. */
  mode: 'free' | 'sequential';
}

/** Lo que se lee de UNA página de intento. */
export interface ParsedPage {
  course: string | null;
  unit: string | null;
  title: string;
  section: string | null;
  attemptId: number | null;
  cmid: number | null;
  navigation: Navigation;
  /** Sólo las preguntas numeradas de esta página, en orden de documento. */
  questions: Question[];
}

export type WarningCode =
  /** La página N no se pudo leer (sesión caducada, error HTTP, página inesperada). */
  | 'page-unavailable'
  /** Navegación secuencial: sólo se exporta la página actual. */
  | 'sequential-navigation'
  /** Pregunta con controles no soportados: se exporta sin opciones. */
  | 'unsupported-question'
  /** Imagen que no se pudo descargar; el Markdown enlaza la URL original. */
  | 'image-not-downloaded';

export interface ExportWarning {
  code: WarningCode;
  /** Dato determinista que acompaña al código: número de página, de pregunta o URL. */
  detail: string;
}

/** Documento canónico de un cuestionario (es lo que se guarda como JSON). */
export interface QuizDocument {
  schemaVersion: 1;
  course: string | null;
  unit: string | null;
  title: string;
  section: string | null;
  source: {
    /** p. ej. "https://moodle.example.test" */
    origin: string;
    /** Siempre "/mod/quiz/attempt.php". */
    path: string;
    attemptId: number | null;
    cmid: number | null;
  };
  navigation: 'free' | 'sequential';
  /** Páginas incluidas en la exportación, ascendentes. */
  pages: number[];
  /** Todas las preguntas exportadas, ordenadas por número. */
  questions: Question[];
  warnings: ExportWarning[];
}

/** Estado de la pestaña activa que el popup necesita para dibujarse. */
export type PageStatus =
  | { kind: 'not-attempt' }
  | { kind: 'login' }
  | {
      kind: 'attempt';
      title: string;
      currentPage: number;
      pages: number[];
      mode: 'free' | 'sequential';
      /** Números de pregunta en la página actual. */
      onPage: number[];
      /** Total de preguntas numeradas según la navegación. */
      total: number;
    };
