// Inicio de sesión del estudiante del laboratorio (lo usan capture.mjs y
// tests/smoke/lab-chrome.mjs). Espera la carga completa del formulario y
// reintenta: enviarlo antes de tiempo deja la sesión en /login/ de forma
// intermitente.
export const STUDENT = { username: 'estudiante1', password: 'Estudiante-lab-1' };

export async function loginAsStudent(page, origin) {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${origin}/login/index.php`, { waitUntil: 'load' });
    if (!new URL(page.url()).pathname.startsWith('/login/')) return; // ya había sesión
    await page.fill('#username', STUDENT.username);
    await page.fill('#password', STUDENT.password);
    await page.click('#loginbtn');
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login/'), { waitUntil: 'domcontentloaded', timeout: 20_000 });
      return;
    } catch {
      lastError = (await page.textContent('.alert, #loginerrormessage').catch(() => null))?.trim() ?? page.url();
    }
  }
  throw new Error(`No se pudo iniciar sesión como ${STUDENT.username}: ${lastError}`);
}
