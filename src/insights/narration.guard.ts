import { AdherenceReport } from './adherence.types';

/**
 * Guarda de proveniência numérica — INV-14.
 *
 * O problema que ele resolve: um modelo "generoso" que escreva "você cumpriu 9
 * dos 12 dias" quando o relatório diz 8 de 12 produz texto impecável e número
 * falso. Nenhuma revisão de estilo pega isso, e nenhuma instrução de prompt
 * garante isso — instrução é pedido, não controle.
 *
 * Então o controle é aqui: todo numeral do texto tem de existir no relatório
 * determinístico. O que não existir reprova a redação, e o redator determinístico
 * assume. É a mesma ideia do `McpDraftEvidence` do NotaFlow — proveniência
 * derivada do que foi calculado, não declarada por quem escreveu.
 *
 * ## O que este guarda NÃO prova
 *
 * Declarado aqui porque a versão anterior deste comentário dizia "proveniência
 * derivada", e isso prometia mais do que o código entrega.
 *
 * 1. **Presença, não relação.** `collectAllowedNumbers` monta um CONJUNTO e
 *    `verifyNarration` só pergunta "este número existe em algum campo?". Ele não
 *    verifica a afirmação. "Você cumpriu 9 de 12 dias" passa se 9 for o
 *    `currentStreak` de um hábito e 12 o `bestStreak` de outro — dois números
 *    verdadeiros, numa frase falsa. E o conjunto **satura**: cada hábito
 *    contribui ~6 escalares mais `weakestWeekdays` e `extrasByWeekday`, então com
 *    quatro ou cinco hábitos quase todo inteiro de 0 a 10 está admitido. O guarda
 *    é forte contra o modelo que INVENTA número e quase cego contra o que
 *    RECOMBINA números verdadeiros.
 * 2. **Só dígitos.** "Oito de doze" por extenso escapa. Por isso o prompt exige
 *    algarismos para toda quantidade — exigência que é parte da defesa, não
 *    estilo. E como o prompt não é artefato versionado nem coberto por teste,
 *    editá-lo pode desarmar esta metade sem quebrar nada. O NotaFlow versiona o
 *    prompt em `AiDraftRun.PromptVersion`; aqui não há equivalente.
 * 3. **Nada que não seja número.** "Seu ponto mais fraco são as quintas" com o
 *    relatório dizendo terça, "sua aderência melhorou" quando caiu, ou o nome do
 *    hábito trocado — tudo passa intacto. A camada promete que todo NÚMERO nasce
 *    de contagem, e isso é verdade; as afirmações qualitativas do texto redigido
 *    não são verificadas por ninguém.
 *
 * ## Por onde NÃO fechar (1)
 *
 * A primeira versão deste comentário dizia que a próxima melhoria óbvia era
 * exigir que pares "a de b" correspondessem a
 * `completedInWindow`/`scheduledDaysInWindow` do mesmo hábito. **Está errado**, e
 * fica registrado porque é o caminho que qualquer um tentaria: o modelo escreve
 * "8 dos 12", inverte a ordem, intercala uma oração — e a regra de pares perde
 * para paráfrase. O guarda cresceria sem nunca fechar.
 *
 * O caminho é outro: parar de validar linguagem natural e restringir o modelo a
 * um contrato tipado, com o código montando o texto — ver `docs/IA.md`, seção
 * "O caminho que fecha (1)". Não está implementado, e depende de decisão de
 * escopo.
 */

export interface NarrationVerdict {
  ok: boolean;
  /** Numerais presentes no texto que não têm origem no relatório. */
  offending: string[];
}

/**
 * Números que a redação pode citar: os do relatório, mais os arredondamentos
 * legítimos de cada um.
 *
 * Arredondar 66.67 para 67 é apresentação; inventar 71 é fabricação. Sem tolerar
 * o arredondamento, o guarda reprovaria toda redação natural e a IA viraria
 * enfeite desligado — que é o oposto do objetivo.
 */
export function collectAllowedNumbers(report: AdherenceReport): Set<number> {
  const allowed = new Set<number>();

  const admit = (value: number | undefined | null): void => {
    if (value === undefined || value === null || !Number.isFinite(value)) return;
    allowed.add(value);
    allowed.add(Math.round(value));
    allowed.add(Math.floor(value));
    allowed.add(Math.ceil(value));
    allowed.add(Math.round(value * 10) / 10);
  };

  admit(report.windowDays);
  admit(report.habitCount);
  admit(report.overallCompletionRate);

  // As partes de `windowStart`/`windowEnd` NÃO entram, de propósito. Admiti-las
  // liberava todo inteiro de 1 a 31 mais o ano — exatamente a faixa em que um
  // número fabricado se esconde ("9 de 12" passaria porque 9 poderia ser um dia
  // do mês). O preço é que a redação não pode escrever data em algarismos, e o
  // prompt exige que ela cite o período como "nos últimos N dias".

  for (const habit of report.habits) {
    admit(habit.scheduledDaysInWindow);
    admit(habit.completedInWindow);
    admit(habit.extraCheckins);
    admit(habit.completionRate);
    admit(habit.currentStreak);
    admit(habit.bestStreak);
    // A quantidade de dias agendados por semana é fato do relatório: quem se
    // compromete com [1,3,5] pode ler "três vezes por semana".
    admit(habit.scheduledDays.length);
    for (const miss of habit.weakestWeekdays) {
      admit(miss.scheduled);
      admit(miss.missed);
    }
    for (const extra of habit.extrasByWeekday) {
      admit(extra.hits);
    }
  }

  // Contagens derivadas do próprio relatório, por contagem e não por estimativa:
  // "duas sequências em risco" é fato verificável do objeto. Sem admiti-las, o
  // redator determinístico não passaria pelo próprio guarda — e o teste
  // `INV-14 redator determinístico passa pelo próprio guarda` existe justamente
  // para manter esta lista honesta se o relatório crescer.
  admit(report.habits.filter((habit) => habit.streakAtRisk).length);
  admit(report.habits.filter((habit) => habit.scheduledDaysInWindow > 0).length);

  // 0 e 100 são âncoras de percentual e aparecem em texto correto ("nenhum",
  // "100%") mesmo quando nenhum campo vale exatamente isso.
  allowed.add(0);
  allowed.add(100);

  return allowed;
}

/**
 * Numerais do texto. Aceita `12`, `12.5` e `12,5` — a redação é em português e
 * vírgula decimal é o normal; tratar `66,67` como "66" e "67" produziria falso
 * positivo em texto correto.
 */
export function extractNumerals(text: string): number[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return matches
    .map((raw) => Number.parseFloat(raw.replace(',', '.')))
    .filter((value) => Number.isFinite(value));
}

export function verifyNarration(text: string, report: AdherenceReport): NarrationVerdict {
  const allowed = collectAllowedNumbers(report);
  const offending: string[] = [];

  for (const value of extractNumerals(text)) {
    if (!allowed.has(value)) offending.push(String(value));
  }

  return { ok: offending.length === 0, offending: [...new Set(offending)] };
}
