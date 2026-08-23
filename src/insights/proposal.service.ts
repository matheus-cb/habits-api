import crypto from 'node:crypto';
import { env } from '@/config/env';
import { HabitsRepository } from '@/repositories/habits.repository';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/utils/errors';
import { AdherenceReport } from './adherence.types';
import { planReschedule, ReschedulePlan } from './reschedule.engine';

/**
 * Reagendamento assistido por IA, por **ação proposta**.
 *
 * A IA não executa nada. O motor determinístico escolhe os dias, o modelo (se
 * houver) redige a justificativa, e a resposta é uma proposta tipada e
 * **assinada**. Só depois de o usuário confirmar é que o hábito muda — e o
 * confirm revalida tudo do zero.
 *
 * Por que a assinatura, e não só um botão na interface: confirmação apenas na
 * tela é contornável chamando o endpoint de execução direto. Se o texto de um
 * hábito puder induzir uma chamada — e título de hábito é entrada do usuário —,
 * a confirmação tem de ser controle de **servidor**. É INV-18 e INV-19.
 *
 * A chave é DERIVADA do `JWT_SECRET` por HKDF, não sorteada por processo.
 *
 * A primeira versão usava `randomBytes` por processo, e isso quebrava duas
 * coisas: a proposta morria a cada restart, e a API não podia rodar em mais de
 * uma instância — a segunda instância recusaria toda proposta assinada pela
 * primeira. Estava declarado como "limitação real", e declarar uma limitação que
 * tem correção de três linhas é pior do que não tê-la.
 *
 * O `JWT_SECRET` já é obrigatório e validado com mínimo de 32 caracteres em
 * `config/env.ts`, então não há variável nova para configurar em produção. O
 * `info` do HKDF separa o domínio: esta chave não serve para assinar token de
 * sessão, e a de sessão não serve para assinar proposta, mesmo vindo do mesmo
 * segredo. Trocar o `JWT_SECRET` invalida as propostas em voo, o que é correto.
 */

const VALIDADE_MS = 10 * 60 * 1000;
const CHAVE_DE_ASSINATURA = Buffer.from(
  crypto.hkdfSync('sha256', env.JWT_SECRET, '', 'habits:reschedule-proposal:v1', 32)
);

interface PropostaAssinada {
  userId: string;
  habitId: string;
  currentScheduledDays: number[];
  proposedScheduledDays: number[];
  expiresAt: number;
}

export interface RescheduleProposal extends ReschedulePlan {
  title: string;
  /** Justificativa em texto. Vem do redator — determinístico ou modelo. */
  rationale: string;
  /** Quem redigiu a justificativa. */
  rationaleSource: 'model' | 'deterministic';
  expiresAt: string;
  /** Token opaco assinado. Sem ele, nada é aplicado. */
  token: string;
}

export interface RescheduleResult {
  habitId: string;
  title: string;
  scheduledDays: number[];
}

export class ProposalService {
  constructor(private habitsRepository: HabitsRepository) {}

  /**
   * Monta as propostas do relatório. Zero propostas é resultado normal — ver
   * `planReschedule`.
   */
  buildProposals(report: AdherenceReport): ReschedulePlan[] {
    return report.habits
      .map((habit) => planReschedule(habit))
      .filter((plan): plan is ReschedulePlan => plan !== null);
  }

  sign(
    userId: string,
    plan: ReschedulePlan,
    now: number = Date.now()
  ): { token: string; expiresAt: Date } {
    const expiresAt = now + VALIDADE_MS;
    const payload: PropostaAssinada = {
      userId,
      habitId: plan.habitId,
      currentScheduledDays: plan.currentScheduledDays,
      proposedScheduledDays: plan.proposedScheduledDays,
      expiresAt,
    };
    return { token: encode(payload), expiresAt: new Date(expiresAt) };
  }

  /**
   * Aplica a proposta — e só ela.
   *
   * A proposta é sugestão, não autorização: nada aqui confia no token além da
   * identidade dos dias. Existência do hábito, dono e formato dos dias são
   * checados de novo, agora (INV-19). Se o hábito foi apagado ou trocou de dono
   * entre propor e confirmar, o confirm falha.
   */
  async confirm(
    userId: string,
    token: string,
    now: number = Date.now(),
    via: 'user' | 'assistant' = 'user'
  ): Promise<RescheduleResult> {
    const payload = decode(token);

    if (now > payload.expiresAt) {
      throw new BadRequestError('Proposta expirada. Peça uma nova sugestão.');
    }

    // O userId vai dentro do payload assinado E é comparado com o do token JWT.
    // Sem esta checagem, um token vazado seria aplicável por qualquer sessão.
    if (payload.userId !== userId) {
      throw new ForbiddenError('Esta proposta não pertence a você');
    }

    const habit = await this.habitsRepository.findById(payload.habitId);
    if (!habit) {
      throw new NotFoundError('Habit');
    }
    if (habit.userId !== userId) {
      throw new ForbiddenError('You do not have access to this habit');
    }

    // INV-19: travamento otimista sobre o agendamento.
    //
    // `currentScheduledDays` viaja assinado no token desde a primeira versão e
    // NÃO era lido — dado assinado e ignorado, que é pior do que dado ausente.
    //
    // O caso que isso abre: às 10h00 a proposta nasce para [1,3,5] → [2,4]; às
    // 10h03 a pessoa edita o hábito à mão para [0,6]; às 10h07 confirma a
    // proposta, ainda dentro dos dez minutos, e o hábito volta para [2,4] — uma
    // decisão tomada sobre um estado que já não existe, apagando a edição
    // manual sem aviso.
    //
    // 409 e não 400: não há nada de inválido na proposta, ela só ficou obsoleta.
    const atual = [...(habit.scheduledDays ?? [])].sort((a, b) => a - b);
    const naProposta = [...payload.currentScheduledDays].sort((a, b) => a - b);
    if (atual.length !== naProposta.length || atual.some((dia, i) => dia !== naProposta[i])) {
      throw new ConflictError(
        'O agendamento deste hábito mudou depois que a sugestão foi gerada. Peça uma nova.'
      );
    }

    // Revalidação de formato: o motor produz conjunto válido, mas o confirm não
    // pode depender disso — ele é a última porta antes da escrita (INV-07).
    const dias = payload.proposedScheduledDays;
    if (
      dias.length === 0 ||
      dias.length > 7 ||
      new Set(dias).size !== dias.length ||
      dias.some((dia) => !Number.isInteger(dia) || dia < 0 || dia > 6)
    ) {
      throw new BadRequestError('Proposta com dias inválidos');
    }

    // `changedVia` repassado, e não deixado no default: o confirm é o único
    // ponto do sistema em que uma escrita nasce de uma proposta REDIGIDA pelo
    // modelo, mesmo com a decisão sendo da pessoa. Gravar isso como `user`
    // apagaria a única marca de que houve IA no caminho.
    //
    // O `update` do repositório grava a revisão do estado anterior na mesma
    // transação — é por isso que esta rota deixou de ser irreversível, e por isso
    // ela usa o mesmo caminho de escrita do `PUT` em vez de um próprio.
    const atualizado = await this.habitsRepository.update(
      habit.id,
      { scheduledDays: [...dias].sort((a, b) => a - b) },
      via
    );

    return {
      habitId: atualizado.id,
      title: atualizado.title,
      scheduledDays: atualizado.scheduledDays ?? [],
    };
  }
}

function encode(payload: PropostaAssinada): string {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const assinatura = crypto.createHmac('sha256', CHAVE_DE_ASSINATURA).update(json).digest();
  return `${base64url(json)}.${base64url(assinatura)}`;
}

function decode(token: string): PropostaAssinada {
  const partes = (token ?? '').split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    throw new BadRequestError('Proposta inválida');
  }

  let json: Buffer;
  let assinatura: Buffer;
  try {
    json = fromBase64url(partes[0]);
    assinatura = fromBase64url(partes[1]);
  } catch {
    throw new BadRequestError('Proposta inválida');
  }

  const esperada = crypto.createHmac('sha256', CHAVE_DE_ASSINATURA).update(json).digest();

  // Comparação em tempo constante: a assinatura é o que impede execução sem
  // confirmação, e `Buffer.equals` sai no primeiro byte diferente.
  if (assinatura.length !== esperada.length || !crypto.timingSafeEqual(assinatura, esperada)) {
    throw new BadRequestError('Proposta inválida ou adulterada');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json.toString('utf8'));
  } catch {
    throw new BadRequestError('Proposta inválida');
  }

  if (!isPropostaAssinada(parsed)) {
    throw new BadRequestError('Proposta inválida');
  }

  return parsed;
}

function isPropostaAssinada(value: unknown): value is PropostaAssinada {
  if (typeof value !== 'object' || value === null) return false;
  const candidato = value as Record<string, unknown>;
  return (
    typeof candidato.userId === 'string' &&
    typeof candidato.habitId === 'string' &&
    typeof candidato.expiresAt === 'number' &&
    Array.isArray(candidato.currentScheduledDays) &&
    Array.isArray(candidato.proposedScheduledDays)
  );
}

function base64url(value: Buffer): string {
  return value.toString('base64url');
}

function fromBase64url(value: string): Buffer {
  const buffer = Buffer.from(value, 'base64url');
  if (buffer.length === 0) throw new Error('vazio');
  return buffer;
}
