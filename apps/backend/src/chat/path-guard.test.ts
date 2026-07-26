import { describe, it, expect } from 'vitest';
import { checkPathAccess } from './path-guard.js';

const REPO = '/Users/tester/trading';

describe('checkPathAccess — secretos', () => {
  it('bloquea el .env de la raíz', () => {
    const r = checkPathAccess('.env', REPO);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/secreto|credencial/i);
  });

  it('bloquea un .env anidado', () => {
    expect(checkPathAccess('apps/backend/.env', REPO).allowed).toBe(false);
  });

  it('bloquea el .env por ruta absoluta', () => {
    expect(checkPathAccess(`${REPO}/apps/backend/.env`, REPO).allowed).toBe(false);
  });

  it('bloquea variantes .env.local / .env.production', () => {
    expect(checkPathAccess('.env.local', REPO).allowed).toBe(false);
    expect(checkPathAccess('.env.production', REPO).allowed).toBe(false);
  });

  it('PERMITE .env.example: es plantilla versionada, sin valores', () => {
    expect(checkPathAccess('.env.example', REPO).allowed).toBe(true);
  });

  it('bloquea claves privadas y credenciales de nube', () => {
    expect(checkPathAccess('~/.ssh/id_rsa', REPO).allowed).toBe(false);
    expect(checkPathAccess('/Users/tester/.aws/credentials', REPO).allowed).toBe(false);
    expect(checkPathAccess('cert/server.pem', REPO).allowed).toBe(false);
  });
});

describe('checkPathAccess — confinamiento al repo', () => {
  it('bloquea rutas absolutas fuera del repo', () => {
    const r = checkPathAccess('/etc/passwd', REPO);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/fuera del repo/i);
  });

  it('bloquea escapes con ..', () => {
    expect(checkPathAccess('../../../etc/passwd', REPO).allowed).toBe(false);
  });

  it('permite rutas relativas dentro del repo', () => {
    expect(checkPathAccess('docs/IA/prompt-maestro-mejora-continua.md', REPO).allowed).toBe(true);
    expect(checkPathAccess('apps/backend/src/index.ts', REPO).allowed).toBe(true);
  });

  it('permite rutas absolutas dentro del repo', () => {
    expect(checkPathAccess(`${REPO}/docs/IA/research`, REPO).allowed).toBe(true);
  });

  it('no confunde un directorio hermano con prefijo parecido', () => {
    // /Users/tester/trading-privado NO está dentro de /Users/tester/trading
    expect(checkPathAccess('/Users/tester/trading-privado/.env', REPO).allowed).toBe(false);
  });

  it('sin ruta (tool sin path) no bloquea: no hay nada que gatear', () => {
    expect(checkPathAccess(undefined, REPO).allowed).toBe(true);
  });
});
