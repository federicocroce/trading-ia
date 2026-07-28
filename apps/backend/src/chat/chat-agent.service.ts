/**
 * Chat agéntico: Claude embebido vía Agent SDK (patrón Jarvis, versión tipada).
 *
 * En vez de armarle el contexto a mano y capado (chat clásico), el agente investiga
 * con tools acotadas: SQL de solo lectura sobre trading.db + lectura de archivos del
 * repo (docs/). Es capa NARRATIVA: el system prompt le prohíbe contradecir los verbos
 * del motor sin declararlo, igual que el chat clásico.
 *
 * Seguridad fail-closed:
 *  - Sin Bash, sin Edit/Write, sin web: solo Read/Grep/Glob + consultar_db.
 *  - consultar_db: guard de SQL (una sentencia SELECT/WITH) + conexión readonly
 *    (better-sqlite3 rechaza escrituras a nivel motor) + cap de filas y celdas.
 *  - Read/Grep/Glob: gate de rutas (path-guard) que niega .env, claves privadas
 *    y cualquier cosa fuera del repo. El agente lee noticias de fuentes externas
 *    por SQL, así que una inyección en el cuerpo de un artículo podría pedirle
 *    que lea las credenciales y las devuelva en la respuesta.
 *  - Timeout duro por turno vía AbortController (CHAT_AGENT_TIMEOUT_MS).
 *
 * Auth: usa las credenciales del login de Claude Code (~/.claude), sin API key.
 */

import { resolve } from 'path';
import Database from 'better-sqlite3';
import { z } from 'zod/v4';
import {
  query,
  tool,
  createSdkMcpServer,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { ANALYST_SYSTEM_PROMPT } from '@trading/shared';
import { validateReadonlySql } from './sql-guard.js';
import { checkPathAccess } from './path-guard.js';
import { buildChatSituationContext } from './chat.service.js';
import { dbPath } from '../db/index.js';
import { envNumber } from '../shared/env-number.js';
import { broadcastChatAgentEvent } from '../shared/ws-manager.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const MAX_ROWS = 200;
const MAX_CELL_CHARS = 500;
/** Tools cuyas rutas pasan por el gate de path-guard. */
const FILE_TOOLS = new Set(['Read', 'Grep', 'Glob']);

// -- tool: consultar_db ------------------------------------------------------

/**
 * Ejecuta un SELECT contra trading.db en una conexión readonly efímera.
 * Puro I/O local y sincrónico (better-sqlite3); expuesto para test directo.
 */
export function runReadonlyQuery(sql: string): {
  ok: boolean;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
} {
  const guard = validateReadonlySql(sql);
  if (!guard.ok) return { ok: false, error: guard.reason };

  let conn: Database.Database | null = null;
  try {
    conn = new Database(dbPath, { readonly: true, fileMustExist: true });
    const all = conn.prepare(sql).all() as Record<string, unknown>[];
    const truncated = all.length > MAX_ROWS;
    // Celdas gigantes (ej: JSON de opportunities) capadas para no reventar el contexto del agente
    const rows = all.slice(0, MAX_ROWS).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'string' && v.length > MAX_CELL_CHARS
          ? `${v.slice(0, MAX_CELL_CHARS)}… [truncado: ${v.length} chars]`
          : v;
      }
      return out;
    });
    return { ok: true, rows, rowCount: all.length, truncated };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    conn?.close();
  }
}

const tradingDbServer = createSdkMcpServer({
  name: 'trading',
  version: '1.0.0',
  tools: [
    tool(
      'consultar_db',
      'Ejecuta una consulta SQL de SOLO LECTURA (una única sentencia SELECT o WITH) sobre la base SQLite del sistema de trading. Para descubrir el esquema: SELECT name, sql FROM sqlite_master WHERE type=\'table\'. Máximo 200 filas por consulta; usá LIMIT y filtros.',
      { sql: z.string().describe('Sentencia SELECT/WITH a ejecutar') },
      async ({ sql }) => {
        const result = runReadonlyQuery(sql);
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        const meta = result.truncated
          ? `\n[${result.rowCount} filas totales, mostrando las primeras ${MAX_ROWS} — refiná con LIMIT/WHERE]`
          : `\n[${result.rowCount} filas]`;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.rows) + meta }],
        };
      },
    ),
  ],
});

// -- system prompt -----------------------------------------------------------

const AGENT_RULES = `
Sos el chat de la app de trading del usuario y tenés tools para investigar antes de responder:
- consultar_db: SQL de solo lectura sobre la base real del sistema (SQLite). Tablas clave: opportunity_scans/opportunity_snapshots (scans del motor), signal_tracking (resultado real de cada señal, R-multiples, outcome win/loss), anticipatory_alerts, discovered_symbols, positions/transactions (cartera), news_items, market_digests/market_reports, cycle_radar_snapshots. Descubrí el esquema exacto con sqlite_master antes de asumir columnas.
- Read/Grep/Glob: el repo de la app (documentación en docs/, incluida la evidencia del sistema en docs/IA/).

Reglas duras:
1. Investigá ANTES de afirmar: si la pregunta toca posiciones, señales, scans o performance, consultá la DB en vez de estimar. Citá de dónde salió cada número.
2. Sos capa narrativa: los verbos de decisión (OPERABLE/EN ESPERA/MANTENER/REVISAR/VENDER) los pone el motor, no vos. Si tu análisis contradice una acción del motor, decilo explícitamente y explicá por qué — nunca lo presentes como la recomendación oficial.
3. Cero humo: si no hay datos suficientes, decí "no sé" o "no hay datos". Jamás inventes convicción ni números.
4. No expongas SQL crudo ni detalles internos salvo que te lo pidan; respondé como analista, no como programador.`;

// -- turno del agente --------------------------------------------------------

export interface AgentChatResult {
  content: string;
  sessionId: string | null;
}

/** El prompt como AsyncIterable: los MCP servers in-process del SDK requieren streaming input. */
async function* singleUserTurn(text: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

/** Resumen corto de la actividad de una tool para mostrar en la UI mientras el agente trabaja. */
export function describeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name.endsWith('consultar_db')) {
    const sql = typeof i.sql === 'string' ? i.sql.replace(/\s+/g, ' ').slice(0, 120) : '';
    return `Consultando la base: ${sql}`;
  }
  if (name === 'Read') return `Leyendo ${typeof i.file_path === 'string' ? i.file_path.replace(`${REPO_ROOT}/`, '') : 'archivo'}`;
  if (name === 'Grep') return `Buscando "${i.pattern ?? ''}" en el repo`;
  if (name === 'Glob') return `Listando archivos ${i.pattern ?? ''}`;
  return `Usando ${name}`;
}

export async function chatAgentTurn(params: {
  message: string;
  sessionId?: string;
  requestId: string;
}): Promise<AgentChatResult> {
  const { message, sessionId, requestId } = params;

  const situationContext = await buildChatSituationContext();
  const systemPrompt = `${ANALYST_SYSTEM_PROMPT}
${AGENT_RULES}

${situationContext}`;

  // Timeout por INACTIVIDAD, no de pared: un turno que sigue emitiendo eventos (tools,
  // texto) está trabajando y no se corta — se corta solo si el agente se queda mudo.
  // Verificado en runtime: un turno pesado legítimo (VIST: varias consultas + noticias)
  // tarda >180s de pared pero nunca queda >120s sin emitir nada.
  const timeoutMs = envNumber('CHAT_AGENT_TIMEOUT_MS', 120_000);
  const abort = new AbortController();
  let timer = setTimeout(() => abort.abort(), timeoutMs);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(), timeoutMs);
  };

  let newSessionId: string | null = sessionId ?? null;
  let finalText = '';

  try {
    const turn = query({
      prompt: singleUserTurn(message),
      options: {
        cwd: REPO_ROOT,
        systemPrompt,
        model: process.env.CHAT_AGENT_MODEL ?? 'sonnet',
        resume: sessionId,
        abortController: abort,
        includePartialMessages: true,
        maxTurns: 25,
        mcpServers: { trading: tradingDbServer },
        // Gate de rutas sobre las tools de archivo. El allowlist de tools no alcanza:
        // Read acepta rutas absolutas, así que sin esto el .env queda al alcance.
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== 'PreToolUse') return {};
                  if (!FILE_TOOLS.has(input.tool_name)) return {};
                  const args = (input.tool_input ?? {}) as Record<string, unknown>;
                  // Read usa file_path; Grep/Glob usan path.
                  const target = typeof args.file_path === 'string' ? args.file_path
                    : typeof args.path === 'string' ? args.path
                    : undefined;
                  const verdict = checkPathAccess(target, REPO_ROOT);
                  if (verdict.allowed) return {};
                  console.warn(`[chat-agent] Ruta bloqueada (${input.tool_name}): ${target}`);
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason: verdict.reason ?? 'Acceso denegado.',
                    },
                  };
                },
              ],
            },
          ],
        },
        allowedTools: ['Read', 'Grep', 'Glob', 'mcp__trading__consultar_db'],
        disallowedTools: [
          'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
          'Task', 'Agent', 'TodoWrite', 'KillShell', 'BashOutput', 'Skill',
        ],
      },
    });

    for await (const msg of turn) {
      touch();
      if (msg.type === 'system' && msg.subtype === 'init') {
        newSessionId = msg.session_id;
      } else if (msg.type === 'stream_event') {
        // Solo texto del hilo principal (no de tools/subagentes)
        if (msg.parent_tool_use_id === null) {
          const evt = msg.event as { type?: string; delta?: { type?: string; text?: string } };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            broadcastChatAgentEvent({ requestId, kind: 'delta', text: evt.delta.text });
          }
        }
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            broadcastChatAgentEvent({ requestId, kind: 'tool', detail: describeToolUse(block.name, block.input) });
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          finalText = msg.result;
        } else {
          throw new Error(`El agente terminó con error (${msg.subtype}).`);
        }
      }
    }
  } catch (err) {
    const reason = abort.signal.aborted
      ? `El agente quedó ${Math.round(timeoutMs / 1000)}s sin responder y se cortó.`
      : err instanceof Error ? err.message : String(err);
    broadcastChatAgentEvent({ requestId, kind: 'error', message: reason });
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }

  if (!finalText.trim()) {
    // Fail-closed honesto: turno sin texto final = error visible, no respuesta vacía silenciosa
    broadcastChatAgentEvent({ requestId, kind: 'error', message: 'El agente no devolvió respuesta.' });
    throw new Error('El agente no devolvió respuesta.');
  }

  broadcastChatAgentEvent({ requestId, kind: 'done' });
  return { content: finalText, sessionId: newSessionId };
}
