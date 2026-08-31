import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(__dirname, '..', '..');

describe('ponte privada do Claude Code', () => {
  it('o executável fica no host e a API recebe apenas URL e segredo da ponte', () => {
    const compose = fs.readFileSync(path.join(RAIZ, 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('CLAUDE_BRIDGE_BASE_URL');
    expect(compose).toContain('CLAUDE_BRIDGE_SECRET');
    expect(compose).not.toContain('HOME: ${HOME');
  });

  it('a ponte abre somente o MCP restrito e zera as ferramentas nativas', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'deploy', 'claude-bridge', 'server.js'), 'utf8');

    expect(fonte).toContain('/mcp/assistente');
    expect(fonte).toContain("'--tools', ''");
    expect(fonte).toContain('mcp__habits__consultar mcp__habits__propor');
    expect(fonte).toContain('mcp__habits__request mcp__habits__agir');
    expect(fonte).toContain("HOST === '0.0.0.0'");
  });

  it('a publicação do MCP é apenas no loopback do host', () => {
    const compose = fs.readFileSync(path.join(RAIZ, 'deploy', 'docker-compose.prod.yml'), 'utf8');

    expect(compose).toContain('127.0.0.1:3334:3333');
    expect(compose).not.toMatch(/['\"]?0\.0\.0\.0:3334/);
  });
});
