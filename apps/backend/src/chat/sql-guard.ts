/**
 * Guard de solo-lectura para el SQL que el agente del chat manda a `consultar_db`.
 *
 * Defensa en profundidad: la conexión a la DB ya se abre con `readonly: true`
 * (better-sqlite3 rechaza escrituras a nivel motor), pero este guard corta ANTES
 * y con mensaje claro. Fail-closed: ante cualquier duda, rechazo.
 */

export type SqlGuardResult = { ok: true } | { ok: false; reason: string };

// Palabras que nunca pueden aparecer fuera de un string literal. Incluye las que
// no escriben datos pero cambian estado del motor o montan otras DBs.
const FORBIDDEN = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'UPSERT',
  'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM', 'REINDEX', 'ANALYZE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
]);

/**
 * Quita comentarios y reemplaza el contenido de strings literales por espacios,
 * preservando la estructura del resto. Escaneo char a char porque una regex no
 * distingue un `;` o un `DELETE` adentro de un string de uno real.
 */
function stripStringsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      // comentario de línea: hasta el \n (que se conserva como separador)
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return out + ' '; // comentario sin cerrar: lo que sigue no cuenta
      out += ' ';
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // string/identificador entrecomillado: saltar hasta el cierre (SQLite escapa duplicando la comilla)
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += `${quote} ${quote}`;
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function validateReadonlySql(sql: string): SqlGuardResult {
  const cleaned = stripStringsAndComments(sql).trim();
  if (!cleaned) return { ok: false, reason: 'SQL vacío o solo comentarios.' };

  // Una única sentencia: los `;` que sobreviven al strip son separadores reales
  const statements = cleaned.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  if (statements.length !== 1) {
    return { ok: false, reason: 'Solo se permite una única sentencia por consulta.' };
  }
  const stmt = statements[0];

  const firstWord = stmt.match(/[A-Za-z_]+/)?.[0]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return { ok: false, reason: `Solo consultas de lectura (SELECT/WITH); recibí '${firstWord ?? '?'}'.` };
  }

  const words = stmt.toUpperCase().match(/[A-Z_]+/g) ?? [];
  const banned = words.find((w) => FORBIDDEN.has(w));
  if (banned) {
    return { ok: false, reason: `Palabra prohibida en consulta de lectura: ${banned}.` };
  }

  return { ok: true };
}
