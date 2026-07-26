import { resolve, basename, extname, sep } from 'node:path';

/**
 * Gate de rutas para las tools de archivo del chat agéntico (Read/Grep/Glob).
 *
 * Dos reglas, en este orden:
 *  1. Secretos: `.env` y variantes, claves privadas, credenciales de nube.
 *     `.env.example` se permite a propósito — es plantilla versionada, sin valores.
 *  2. Confinamiento: la ruta tiene que caer dentro del repo.
 *
 * Por qué existe: el agente lee noticias de fuentes externas vía SQL y tiene
 * Read sobre el repo. Sin este gate, una inyección en el cuerpo de un artículo
 * puede pedirle que lea el .env y devuelva las claves en la respuesta.
 *
 * Función pura (resolve solo manipula strings, no toca el disco) para poder
 * testearla sin mocks.
 */

export interface PathAccessResult {
  allowed: boolean;
  reason?: string;
}

const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);
const SECRET_BASENAMES = new Set([
  'credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.netrc',
  '.pgpass',
]);

/** `.env`, `.env.local`, `.env.production`… pero NO `.env.example`. */
function isDotEnv(name: string): boolean {
  if (name === '.env.example' || name === '.env.sample' || name === '.env.template') return false;
  return name === '.env' || name.startsWith('.env.');
}

function isSecretName(name: string): boolean {
  return isDotEnv(name) || SECRET_BASENAMES.has(name) || SECRET_EXTENSIONS.has(extname(name));
}

export function checkPathAccess(rawPath: string | undefined, repoRoot: string): PathAccessResult {
  // Sin ruta no hay nada que gatear (p. ej. un Glob sin path explícito).
  if (!rawPath || rawPath.trim() === '') return { allowed: true };

  const candidate = rawPath.trim();

  if (isSecretName(basename(candidate))) {
    return { allowed: false, reason: `Acceso denegado: ${candidate} puede contener credenciales o secretos.` };
  }

  // `~` es el home del usuario, nunca el repo — no dejar que resolve() lo trate
  // como un directorio relativo y lo dé por adentro.
  const isHomeRelative = candidate === '~' || candidate.startsWith('~/');
  const absolute = isHomeRelative ? candidate : resolve(repoRoot, candidate);
  const root = resolve(repoRoot);

  // El separador evita que `/repo-privado` matchee como hijo de `/repo`.
  const inside = absolute === root || absolute.startsWith(root + sep);
  if (!inside) {
    return { allowed: false, reason: `Acceso denegado: ${candidate} está fuera del repo.` };
  }

  return { allowed: true };
}
