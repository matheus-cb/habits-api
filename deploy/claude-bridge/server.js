/*
 * Ponte privada do Habits para o Claude Code autenticado no host.
 *
 * Ela é deliberadamente separada da API: o container não recebe HOME, a
 * credencial OAuth nem o executável do Claude. A ponte só escuta no gateway
 * privado do Docker e só conhece a superfície MCP `/mcp/assistente`, que expõe
 * `consultar` e `propor` — nunca uma escrita executável.
 */
'use strict';

const http = require('node:http');
const { execFile } = require('node:child_process');
const { timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.HABITS_BRIDGE_PORT || 5100);
const HOST = process.env.HABITS_BRIDGE_HOST || '172.17.0.1';
const SECRET = process.env.HABITS_BRIDGE_SECRET || '';
const CLAUDE = process.env.CLAUDE_BIN || '/var/lib/nfagent/.local/bin/claude';
const MODEL = process.env.HABITS_ASSISTANT_MODEL || 'sonnet';
const MCP_URL = process.env.HABITS_MCP_URL || 'http://127.0.0.1:3334/mcp/assistente';
const TIMEOUT_MS = Number(process.env.HABITS_BRIDGE_TIMEOUT_MS || 180_000);
const MAX_BODY = 128_000;

if (!SECRET || SECRET.length < 32) throw new Error('HABITS_BRIDGE_SECRET é obrigatório e longo.');
if (HOST === '0.0.0.0' || HOST === '::') throw new Error('A ponte não pode ser pública.');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\/mcp\/assistente$/.test(MCP_URL)) {
  throw new Error('HABITS_MCP_URL precisa ser o endpoint local restrito do Habits.');
}

function segredoConfere(recebido) {
  if (typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, body) {
  const dados = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) });
  res.end(dados);
}

function respostaDoClaude(bruto) {
  const inicio = bruto.indexOf('{');
  if (inicio < 0) throw new Error('resposta sem JSON');
  const dado = JSON.parse(bruto.slice(inicio));
  if (dado.is_error) throw new Error('o Claude Code recusou a execução');
  return {
    texto: typeof dado.result === 'string' ? dado.result : '',
    sessionId: typeof dado.session_id === 'string' ? dado.session_id : '',
    turnos: Number.isFinite(dado.num_turns) ? dado.num_turns : 0,
    custoUsd: Number.isFinite(dado.total_cost_usd) ? dado.total_cost_usd : 0,
    tokensDeSaida: Number.isFinite(dado.usage?.output_tokens) ? dado.usage.output_tokens : 0,
    duracaoMs: Number.isFinite(dado.duration_api_ms) ? dado.duration_api_ms : 0,
    desfecho: typeof dado.stop_reason === 'string' ? dado.stop_reason : 'sem_motivo',
  };
}

function executar(pedido) {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'habits-mcp-'));
  const configuracao = path.join(diretorio, 'mcp.json');
  fs.writeFileSync(configuracao, JSON.stringify({
    mcpServers: {
      habits: {
        type: 'http',
        url: MCP_URL,
        headers: {
          Authorization: `Bearer ${pedido.token}`,
          'x-habits-conversation-id': pedido.conversationId,
        },
      },
    },
  }), { mode: 0o600 });

  const args = [
    '-p', pedido.mensagem,
    '--output-format', 'json',
    '--model', MODEL,
    '--tools', '',
    '--mcp-config', configuracao,
    '--append-system-prompt', pedido.sistema,
    '--allowedTools', 'mcp__habits__consultar mcp__habits__propor',
    '--disallowedTools', 'mcp__habits__request mcp__habits__agir',
    ...(pedido.sessionId ? ['--resume', pedido.sessionId] : []),
  ];

  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const filho = execFile(CLAUDE, args, {
      cwd: diretorio,
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TERM: 'dumb',
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
      },
    }, (erro, stdout, stderr) => {
      fs.rmSync(diretorio, { recursive: true, force: true });
      if (erro) {
        // Não registre stderr: ele pode conter a entrada da pessoa.
        console.error(`Claude Code falhou em ${Date.now() - inicio}ms (código ${erro.code ?? 'desconhecido'}).`);
        reject(new Error('execução recusada'));
        return;
      }
      try {
        resolve(respostaDoClaude(stdout));
      } catch {
        console.error(`Resposta do Claude Code inválida em ${Date.now() - inicio}ms.`);
        reject(new Error('resposta inválida'));
      }
    });
  });
}

const servidor = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
  if (req.method !== 'POST' || req.url !== '/habits') return json(res, 404, { erro: 'rota desconhecida' });

  let corpo = '';
  req.on('data', (pedaço) => {
    corpo += pedaço;
    if (corpo.length > MAX_BODY) req.destroy();
  });
  req.on('end', async () => {
    let pedido;
    try { pedido = JSON.parse(corpo); } catch { return json(res, 400, { erro: 'json inválido' }); }
    if (!segredoConfere(pedido.segredo)) return json(res, 401, { erro: 'não autorizado' });
    if (typeof pedido.mensagem !== 'string' || !pedido.mensagem.trim() || pedido.mensagem.length > 24_000) {
      return json(res, 400, { erro: 'mensagem inválida' });
    }
    if (typeof pedido.sistema !== 'string' || pedido.sistema.length > 48_000 ||
        typeof pedido.token !== 'string' || pedido.token.length > 16_000 ||
        typeof pedido.conversationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(pedido.conversationId) ||
        (pedido.sessionId !== null && (typeof pedido.sessionId !== 'string' || pedido.sessionId.length > 256))) {
      return json(res, 400, { erro: 'metadados inválidos' });
    }
    const inicio = Date.now();
    try {
      const resposta = await executar(pedido);
      console.log(`Habits respondeu em ${Date.now() - inicio}ms; ${resposta.texto.length} caracteres.`);
      json(res, 200, { resposta });
    } catch {
      json(res, 502, { erro: 'Claude Code indisponível' });
    }
  });
});

servidor.listen(PORT, HOST, () => console.log(`Ponte Habits em ${HOST}:${PORT}.`));
