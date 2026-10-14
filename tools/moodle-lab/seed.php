<?php
// Siembra del laboratorio Moodle (issue #12). Se ejecuta dentro del
// contenedor: `tools/moodle-lab/lab.sh seed`.
//
// Crea (o recrea) el curso MQX-LAB con cuestionarios que cubren los casos
// de la extensión, un estudiante y sus intentos. Usa los generadores de
// datos de prueba del propio Moodle. Todo el contenido es inventado.
//
// Imprime en la salida estándar un JSON con los cmid e ids de intento que
// usa capture.mjs.

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/mod/quiz/locallib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/question/format/xml/format.php');

use mod_quiz\quiz_attempt;
use mod_quiz\quiz_settings;

const COURSE_SHORTNAME = 'MQX-LAB';
const STUDENT_USERNAME = 'estudiante1';
const STUDENT_PASSWORD = 'Estudiante-lab-1';

\core\session\manager::set_user(get_admin());
$gen = new testing_data_generator();
$quizgen = $gen->get_plugin_generator('mod_quiz');

// Idioma de la interfaz como en la UnADM (es_mx), si el paquete está.
if (file_exists($CFG->dataroot . '/lang/es_mx/langconfig.php')) {
    set_config('lang', 'es_mx');
}
$lang = get_config('core', 'lang') ?: 'en';

// --- Curso y estudiante -----------------------------------------------------

if ($old = $DB->get_record('course', ['shortname' => COURSE_SHORTNAME])) {
    delete_course($old, false);
}
$course = $gen->create_course([
    'fullname' => 'Laboratorio MQX – Cuestionarios de prueba',
    'shortname' => COURSE_SHORTNAME,
    'numsections' => 2,
]);
course_update_section($course, $DB->get_record('course_sections', ['course' => $course->id, 'section' => 1]),
    ['name' => 'Unidad 1']);
course_update_section($course, $DB->get_record('course_sections', ['course' => $course->id, 'section' => 2]),
    ['name' => 'Unidad 2']);

$student = $DB->get_record('user', ['username' => STUDENT_USERNAME]);
if (!$student) {
    $student = $gen->create_user([
        'username' => STUDENT_USERNAME,
        'password' => STUDENT_PASSWORD,
        'firstname' => 'Estudiante',
        'lastname' => 'Laboratorio',
        'email' => 'estudiante1@example.invalid',
        'lang' => $lang,
    ]);
} else {
    $DB->set_field('user', 'lang', $lang, ['id' => $student->id]);
}
$gen->enrol_user($student->id, $course->id, 'student');

// --- Preguntas: Moodle XML versionado (questions.xml) ------------------------

/** PNG pequeño y determinista: un color de fondo con una franja blanca. */
function lab_png(int $r, int $g, int $b, int $w, int $h): string {
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, imagecolorallocate($img, $r, $g, $b));
    imagefilledrectangle($img, 0, intdiv($h, 3), $w - 1, intdiv(2 * $h, 3), imagecolorallocate($img, 255, 255, 255));
    ob_start();
    imagepng($img, null, 9);
    return ob_get_clean();
}

$coursecontext = context_course::instance($course->id);
$bank = \core_question\local\bank\question_bank_helper::get_default_open_instance_system_type($course, true);
$bankcontext = context_module::instance($bank->id);
$category = question_get_default_category($bankcontext->id, true);

$xml = preg_replace_callback('/\{\{png:(\d+),(\d+),(\d+),(\d+),(\d+)\}\}/',
    fn($m) => base64_encode(lab_png((int)$m[1], (int)$m[2], (int)$m[3], (int)$m[4], (int)$m[5])),
    file_get_contents(__DIR__ . '/questions.xml'));
$xmlfile = make_request_directory() . '/questions.xml';
file_put_contents($xmlfile, $xml);

$format = new qformat_xml();
$format->setCategory($category);
$format->setContexts([$bankcontext]);
$format->setCourse($course);
$format->setFilename($xmlfile);
$format->setRealfilename('questions.xml');
$format->setMatchgrades('error');
$format->setCatfromfile(false);
$format->setContextfromfile(false);
$format->setStoponerror(true);
$format->set_display_progress(false);
ob_start();
$ok = $format->importpreprocess() && $format->importprocess() && $format->importpostprocess();
$importlog = ob_get_clean();
if (!$ok) {
    fwrite(STDERR, strip_tags($importlog) . "\n");
    throw new moodle_exception('La importación de questions.xml falló.');
}

$q = [];
$sql = "SELECT q.id, q.name
          FROM {question} q
          JOIN {question_versions} qv ON qv.questionid = q.id
          JOIN {question_bank_entries} qbe ON qbe.id = qv.questionbankentryid
         WHERE qbe.questioncategoryid = :cat AND q.parent = 0";
foreach ($DB->get_records_sql($sql, ['cat' => $category->id]) as $row) {
    $q[$row->name] = $row;
}

function lab_quiz(string $name, int $section, array $settings, array $pages): stdClass {
    global $gen, $course;
    $quiz = $gen->create_module('quiz', array_merge([
        'course' => $course->id,
        'section' => $section,
        'name' => $name,
        'shuffleanswers' => 0,
        'preferredbehaviour' => 'deferredfeedback',
    ], $settings));
    foreach ($pages as $i => $questions) {
        foreach ($questions as $q) {
            quiz_add_quiz_question($q->id, $quiz, $i + 1);
        }
    }
    quiz_settings::create($quiz->id)->get_grade_calculator()->recompute_quiz_sumgrades();
    return $quiz;
}

/** Intento del estudiante; `$responses` por slot, `$finish` lo envía. */
function lab_attempt(stdClass $quiz, array $responses = [], bool $finish = false): int {
    global $quizgen, $student;
    \core\session\manager::set_user($student);
    $attempt = $quizgen->create_attempt($quiz->id, $student->id);
    // Como mod_quiz_generator::submit_responses, pero con la API pública
    // (aquél usa get_question_usage(), reservado a PHPUnit).
    $attemptobj = quiz_attempt::create($attempt->id);
    $postdata = [];
    foreach ($responses as $slot => $summary) {
        $qa = $attemptobj->get_question_attempt($slot);
        $postdata[$qa->get_control_field_name('sequencecheck')] = (string)$qa->get_sequence_check_count();
        $postdata[$qa->get_flag_field_name()] = (string)(int)$qa->is_flagged();
        // Texto visible (p. ej. 'Linux') o, si depende del idioma, las
        // variables de respuesta tal cual (p. ej. ['answer' => '0']).
        $response = is_array($summary) ? $summary : $qa->get_question()->un_summarise_response($summary);
        foreach ($response as $name => $value) {
            $postdata[$qa->get_qt_field_name($name)] = (string)$value;
        }
    }
    if ($postdata) {
        $attemptobj->process_submitted_actions(time(), false, $postdata);
    }
    if ($finish) {
        $attemptobj->process_submit(time(), false);
        $attemptobj->process_grade_submission(time());
    }
    \core\session\manager::set_user(get_admin());
    return (int)$attempt->id;
}

// --- Cuestionarios -------------------------------------------------------------

$free = ['navmethod' => QUIZ_NAVMETHOD_FREE];
$seq = ['navmethod' => QUIZ_NAVMETHOD_SEQ];

$quizzes = [];
$quizzes['una-pagina'] = lab_quiz('Una página', 1, $free, [[$q['so'], $q['kernel'], $q['ram'], $q['bin']]]);
$quizzes['libre'] = lab_quiz('Varias páginas (navegación libre)', 1, $free, [
    [$q['so'], $q['transporte']], [$q['kernel'], $q['diagrama']], [$q['primos'], $q['capital']],
]);
$quizzes['secuencial'] = lab_quiz('Varias páginas (navegación secuencial)', 1, $seq, [
    [$q['ram'], $q['bin']], [$q['tierra'], $q['capital']],
]);
$quizzes['imagenes'] = lab_quiz('Imágenes en enunciado y opciones', 2, $free, [[$q['diagrama'], $q['colores']]]);
$quizzes['no-soportadas'] = lab_quiz('Tipos no soportados', 2, $free, [[
    $q['so'], $q['emparejamiento'], $q['respuesta-corta'], $q['numerica'], $q['ensayo'], $q['huecos'], $q['cloze'],
]]);
$quizzes['revision'] = lab_quiz('Revisión completa', 2, $free, [
    [$q['so'], $q['transporte'], $q['kernel']], [$q['bin'], $q['primos'], $q['capital']],
]);
// Revisión sin respuesta correcta ni retroalimentación tras cerrar el intento.
$limited = $free;
foreach (['immediately', 'open', 'closed'] as $when) {
    $limited["rightanswer$when"] = 0;
    $limited["specificfeedback$when"] = 0;
    $limited["generalfeedback$when"] = 0;
}
$quizzes['revision-limitada'] = lab_quiz('Revisión limitada', 2, $limited, [[$q['so'], $q['ram'], $q['capital']]]);

// --- Intentos --------------------------------------------------------------------

$attempts = [];
// En curso, con una respuesta guardada para ver "Respuesta guardada".
$attempts['una-pagina'] = lab_attempt($quizzes['una-pagina'], [1 => 'Linux']);
$attempts['libre'] = lab_attempt($quizzes['libre']);
$attempts['secuencial'] = lab_attempt($quizzes['secuencial']);
$attempts['imagenes'] = lab_attempt($quizzes['imagenes']);
$attempts['no-soportadas'] = lab_attempt($quizzes['no-soportadas']);
// Terminados: aciertos, errores, parcial y una sin responder.
$attempts['revision'] = lab_attempt($quizzes['revision'], [
    1 => 'Linux',            // correcta
    2 => 'TCP',              // múltiple parcial (falta UDP)
    3 => ['answer' => '0'],  // incorrecta: «Falso» (verdadero/falso)
    4 => '12',               // incorrecta
    // 5 sin responder
    6 => 'Ciudad de México', // correcta
], true);
$attempts['revision-limitada'] = lab_attempt($quizzes['revision-limitada'], [1 => 'HTTP', 2 => 'Volátil'], true);

$out = ['wwwroot' => $CFG->wwwroot, 'courseid' => (int)$course->id, 'lang' => $lang, 'quizzes' => []];
foreach ($quizzes as $key => $quiz) {
    $out['quizzes'][$key] = ['cmid' => (int)$quiz->cmid, 'attempt' => $attempts[$key] ?? null];
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
