/**
 * T13: 復帰フロー（RF）＋ エスカレーション判断（ES）ステートマシン テスト
 *
 * 検証対象: INV-RF1〜RF6（6個）、INV-ES1〜ES3（3個）
 * 出典: docs/spec-recovery-escalation.md §7
 */

import { describe, it, expect } from 'vitest';
import { createActor, assign } from 'xstate';
import { recoveryFlowMachine } from '../recovery-flow';
import type { ProblemAnalysis, RecoveryFlowContext } from '../types';

// --- テストヘルパー ---

/** テスト用の問題分析結果を生成（デフォルト: 全フラグoff） */
function makeAnalysis(
  overrides: Partial<ProblemAnalysis> = {},
): ProblemAnalysis {
  return {
    verbalization: 'test problem',
    causeAnalysis: 'test cause',
    essenceIdentification: 'test essence',
    hasSecurityIssue: false,
    hasProductionImpact: false,
    hasDataLossRisk: false,
    retreatCount: 0,
    isUnknownCause: false,
    isOutOfSkillScope: false,
    ...overrides,
  };
}

/** マシンを開始する */
function startMachine() {
  const actor = createActor(recoveryFlowMachine);
  actor.start();
  return actor;
}

/**
 * 特定のアプローチを注入してマシンを起動する
 * provide()でselectApproachアクションをオーバーライドし、
 * approachSelection到達時に指定アプローチをcontextに設定する
 */
function startWithApproach(approach: 'A' | 'B' | 'C' | 'D') {
  const machine = recoveryFlowMachine.provide({
    actions: {
      selectApproach: assign({
        selectedApproach: () =>
          approach as RecoveryFlowContext['selectedApproach'],
      }),
    },
  });
  const actor = createActor(machine);
  actor.start();
  return actor;
}

/** Step 1（問題分析）を通過する */
function advanceThroughStep1(
  actor: ReturnType<typeof startMachine>,
  analysisResult: ProblemAnalysis,
) {
  actor.send({ type: 'PROBLEM_VERBALIZED' });
  actor.send({ type: 'CAUSE_ANALYZED' });
  actor.send({ type: 'ESSENCE_IDENTIFIED', analysisResult });
}

// =============================================================================
// INV-RF1: 問題の分析はRFの最初のステップとして必ず実行される
// =============================================================================

describe('INV-RF1: 問題の分析はRFの最初のステップとして必ず実行される', () => {
  it('RFの初期状態がproblemAnalysis.verbalizeProblemである', () => {
    const actor = startMachine();

    expect(actor.getSnapshot().value).toEqual({
      problemAnalysis: 'verbalizeProblem',
    });
    actor.stop();
  });

  it('Step 1はT1→T2→T3の順序で遷移する', () => {
    const actor = startMachine();
    const history: (string | object)[] = [];

    history.push(actor.getSnapshot().value);

    actor.send({ type: 'PROBLEM_VERBALIZED' });
    history.push(actor.getSnapshot().value);

    actor.send({ type: 'CAUSE_ANALYZED' });
    history.push(actor.getSnapshot().value);

    expect(history).toEqual([
      { problemAnalysis: 'verbalizeProblem' },
      { problemAnalysis: 'analyzeCause' },
      { problemAnalysis: 'identifyEssence' },
    ]);
    actor.stop();
  });

  it('verbalizeProblem状態でCAUSE_ANALYZEDを送信しても遷移しない', () => {
    const actor = startMachine();

    actor.send({ type: 'CAUSE_ANALYZED' });

    expect(actor.getSnapshot().value).toEqual({
      problemAnalysis: 'verbalizeProblem',
    });
    actor.stop();
  });
});

// =============================================================================
// INV-RF2: CLAUDE.md記録は全パスから必須（いかなるアプローチでも省略できない）
// =============================================================================

describe('INV-RF2: CLAUDE.md記録は全パスから必須', () => {
  it('アプローチA完了 → recordToClaudeMdに到達する', () => {
    const actor = startWithApproach('A');
    advanceThroughStep1(actor, makeAnalysis());

    // escalationCheck → approachSelection → A → directResolution
    expect(actor.getSnapshot().value).toEqual({
      directResolution: 'humanDirectFix',
    });

    actor.send({ type: 'HUMAN_FIX_COMPLETE' });
    expect(actor.getSnapshot().value).toEqual({
      directResolution: 'askAiExplanation',
    });

    actor.send({ type: 'AI_EXPLANATION_RECEIVED' });
    expect(actor.getSnapshot().value).toBe('recordToClaudeMd');
    actor.stop();
  });

  it('アプローチB完了 → recordToClaudeMdに到達する', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());

    // escalationCheck → approachSelection → B → redecompose
    expect(actor.getSnapshot().value).toBe('redecompose');

    actor.send({ type: 'REDECOMPOSE_COMPLETE' });
    expect(actor.getSnapshot().value).toBe('recordToClaudeMd');
    actor.stop();
  });

  it('アプローチC完了 → recordToClaudeMdに到達する', () => {
    const actor = startWithApproach('C');
    advanceThroughStep1(actor, makeAnalysis());

    // escalationCheck → approachSelection → C → resetContext
    expect(actor.getSnapshot().value).toBe('resetContext');

    actor.send({ type: 'CONTEXT_RESET_COMPLETE' });
    expect(actor.getSnapshot().value).toBe('recordToClaudeMd');
    actor.stop();
  });

  it('アプローチD（ES-ESC経由）→ consultTeam → recordToClaudeMdに到達する', () => {
    // retreatCount=3でES-GW2にヒットさせ、ESCを得る
    const actor = startMachine();
    advanceThroughStep1(actor, makeAnalysis({ retreatCount: 3 }));

    // escalationCheck → no immediate → approachSelection → D(fallback) → ES
    // ES: checkImmediate → no → check30Min → retreat3=true → consider30Min
    expect(actor.getSnapshot().value).toEqual({
      escalationJudgment: 'consider30Min',
    });

    actor.send({ type: 'ESCALATION_DECIDED' });
    // ES → escalationConfirmed → onDone → consultTeam
    expect(actor.getSnapshot().value).toBe('consultTeam');

    actor.send({ type: 'TEAM_CONSULTED' });
    expect(actor.getSnapshot().value).toBe('recordToClaudeMd');
    actor.stop();
  });

  it('GW1直行エスカレーション → consultTeam → recordToClaudeMdに到達する', () => {
    const actor = startMachine();
    advanceThroughStep1(actor, makeAnalysis({ hasSecurityIssue: true }));

    // escalationCheck → needsImmediate=true → escalationJudgment
    // ES: checkImmediate → security=true → executeImmediate
    expect(actor.getSnapshot().value).toEqual({
      escalationJudgment: 'executeImmediate',
    });

    actor.send({ type: 'ESCALATION_DECIDED' });
    // ES → escalationConfirmed → onDone → consultTeam
    expect(actor.getSnapshot().value).toBe('consultTeam');

    actor.send({ type: 'TEAM_CONSULTED' });
    expect(actor.getSnapshot().value).toBe('recordToClaudeMd');
    actor.stop();
  });
});

// =============================================================================
// INV-RF3: 次回の回避策の明記（RF-T10）はRF-T9の後に必ず実行される
// =============================================================================

describe('INV-RF3: 回避策文書化はRF-T9の後に必ず実行される', () => {
  it('CLAUDE_MD_RECORDED → documentWorkaroundに遷移する', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());
    actor.send({ type: 'REDECOMPOSE_COMPLETE' });

    expect(actor.getSnapshot().value).toBe('recordToClaudeMd');

    actor.send({ type: 'CLAUDE_MD_RECORDED' });
    expect(actor.getSnapshot().value).toBe('documentWorkaround');
    actor.stop();
  });

  it('WORKAROUND_DOCUMENTED → teamShareDecisionに遷移する', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());
    actor.send({ type: 'REDECOMPOSE_COMPLETE' });
    actor.send({ type: 'CLAUDE_MD_RECORDED' });

    expect(actor.getSnapshot().value).toBe('documentWorkaround');

    actor.send({ type: 'WORKAROUND_DOCUMENTED' });
    // teamShareDecisionはalways遷移。shouldShareWithTeam=false → recoveryComplete
    expect(actor.getSnapshot().value).toBe('recoveryComplete');
    actor.stop();
  });
});

// =============================================================================
// INV-RF4: 復帰フローは常にメインフローSE-1に戻る
// =============================================================================

describe('INV-RF4: 復帰フローは常にrecoveryCompleteで終了する', () => {
  it('チーム共有なし → recoveryCompleteに到達する', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());
    actor.send({ type: 'REDECOMPOSE_COMPLETE' });
    actor.send({ type: 'CLAUDE_MD_RECORDED' });
    actor.send({ type: 'WORKAROUND_DOCUMENTED' });

    // shouldShareWithTeam=false → recoveryComplete直行
    expect(actor.getSnapshot().value).toBe('recoveryComplete');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  it('チーム共有あり → shareWithTeam → recoveryCompleteに到達する', () => {
    // documentWorkaroundのentryでshouldShareWithTeamをtrueに設定
    const machine = recoveryFlowMachine.provide({
      actions: {
        selectApproach: assign({
          selectedApproach: () =>
            'C' as RecoveryFlowContext['selectedApproach'],
        }),
        documentWorkaround: assign({
          shouldShareWithTeam: () => true,
        }),
      },
    });
    const actor = createActor(machine);
    actor.start();

    advanceThroughStep1(actor, makeAnalysis());
    actor.send({ type: 'CONTEXT_RESET_COMPLETE' });
    actor.send({ type: 'CLAUDE_MD_RECORDED' });
    actor.send({ type: 'WORKAROUND_DOCUMENTED' });

    // shouldShareWithTeam=true → shareWithTeam
    expect(actor.getSnapshot().value).toBe('shareWithTeam');

    actor.send({ type: 'TEAM_SHARED' });
    expect(actor.getSnapshot().value).toBe('recoveryComplete');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  it('output === { recovered: true }', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());
    actor.send({ type: 'REDECOMPOSE_COMPLETE' });
    actor.send({ type: 'CLAUDE_MD_RECORDED' });
    actor.send({ type: 'WORKAROUND_DOCUMENTED' });

    expect(actor.getSnapshot().output).toEqual({ recovered: true });
    actor.stop();
  });
});

// =============================================================================
// INV-RF5: アプローチ選択はStep 1完了後にのみ実行される
// =============================================================================

describe('INV-RF5: アプローチ選択はStep 1完了後にのみ実行される', () => {
  it('Step 1完了後にescalationCheck経由でapproachSelectionに到達する', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());

    // escalationCheck(always) → approachSelection(always) → redecompose
    // always遷移のため中間状態は観測不可だが、redecompose到達で通過を確認
    expect(actor.getSnapshot().value).toBe('redecompose');
    actor.stop();
  });

  it('Step 1の途中からapproachSelection関連の状態に遷移できない', () => {
    const actor = startMachine();

    // verbalizeProblemのみ完了、analyzeCauseで停止
    actor.send({ type: 'PROBLEM_VERBALIZED' });

    // approachSelectionに関連するイベントを送信しても無視される
    actor.send({ type: 'REDECOMPOSE_COMPLETE' });
    actor.send({ type: 'CONTEXT_RESET_COMPLETE' });

    expect(actor.getSnapshot().value).toEqual({
      problemAnalysis: 'analyzeCause',
    });
    actor.stop();
  });
});

// =============================================================================
// INV-RF6: アプローチは4パターン（A/B/C/D）のいずれか1つが選択される
// =============================================================================

describe('INV-RF6: アプローチは4パターン排他選択', () => {
  it('selectedApproach="A" → directResolutionに遷移する', () => {
    const actor = startWithApproach('A');
    advanceThroughStep1(actor, makeAnalysis());

    expect(actor.getSnapshot().value).toEqual({
      directResolution: 'humanDirectFix',
    });
    actor.stop();
  });

  it('selectedApproach="B" → redecomposeに遷移する', () => {
    const actor = startWithApproach('B');
    advanceThroughStep1(actor, makeAnalysis());

    expect(actor.getSnapshot().value).toBe('redecompose');
    actor.stop();
  });

  it('selectedApproach="C" → resetContextに遷移する', () => {
    const actor = startWithApproach('C');
    advanceThroughStep1(actor, makeAnalysis());

    expect(actor.getSnapshot().value).toBe('resetContext');
    actor.stop();
  });

  it('selectedApproach=null → escalationJudgmentに遷移する（フォールバック: D）', () => {
    // 全ESフラグoff → ES-SELF → approachSelection のループを回避するため、
    // 2回目のapproachSelection入りでアプローチBに切り替える
    let callCount = 0;
    const machine = recoveryFlowMachine.provide({
      actions: {
        selectApproach: assign({
          selectedApproach: (): RecoveryFlowContext['selectedApproach'] => {
            callCount++;
            return callCount > 1 ? 'B' : null;
          },
        }),
      },
    });
    const actor = createActor(machine);
    actor.start();

    advanceThroughStep1(actor, makeAnalysis());
    // 1回目: null → D → ES → SELF → approachSelection
    // 2回目: 'B' → redecompose
    expect(actor.getSnapshot().value).toBe('redecompose');
    actor.stop();
  });

  it('approachSelectionのalways遷移の最後がescalationJudgmentへのフォールバック', () => {
    const states = recoveryFlowMachine.config.states;
    const approachConfig = states?.approachSelection as {
      always?: { guard?: string; target?: string }[];
    };
    const alwaysTransitions = approachConfig?.always;

    expect(alwaysTransitions).toBeDefined();
    if (alwaysTransitions) {
      const lastTransition = alwaysTransitions[alwaysTransitions.length - 1];
      // フォールバック（ガードなし）がescalationJudgmentを指す
      expect(lastTransition.guard).toBeUndefined();
      expect(lastTransition.target).toBe('escalationJudgment');
    }
  });
});

// =============================================================================
// INV-ES1: 「即座に」の判定（ES-GW1）は「30分以内」の判定（ES-GW2）に先行する
// =============================================================================

describe('INV-ES1: GW1（即座）がGW2（30分以内）に先行する', () => {
  it('ESの初期状態がcheckImmediateである', () => {
    const esConfig = recoveryFlowMachine.config.states?.escalationJudgment as {
      initial?: string;
    };

    expect(esConfig?.initial).toBe('checkImmediate');
  });

  it('マシン定義でcheckImmediate→check30Minの順序が正しい', () => {
    const esStates = (
      recoveryFlowMachine.config.states?.escalationJudgment as {
        states?: Record<string, unknown>;
      }
    )?.states;

    expect(esStates).toBeDefined();
    if (esStates) {
      const stateNames = Object.keys(esStates);
      const checkImIdx = stateNames.indexOf('checkImmediate');
      const check30Idx = stateNames.indexOf('check30Min');
      expect(checkImIdx).toBeLessThan(check30Idx);
    }
  });
});

// =============================================================================
// INV-ES2: セキュリティ等に該当する場合、即座にエスカレーション（遅延不可）
// =============================================================================

describe('INV-ES2: セキュリティ等で即座にエスカレーション', () => {
  it('セキュリティ問題あり → executeImmediate → escalationConfirmed', () => {
    const actor = startMachine();
    advanceThroughStep1(actor, makeAnalysis({ hasSecurityIssue: true }));

    // escalationCheck → ES → checkImmediate → executeImmediate
    expect(actor.getSnapshot().value).toEqual({
      escalationJudgment: 'executeImmediate',
    });

    actor.send({ type: 'ESCALATION_DECIDED' });
    // escalationConfirmed(final) → onDone → consultTeam
    expect(actor.getSnapshot().value).toBe('consultTeam');
    expect(actor.getSnapshot().context.escalationResult).toBe('escalate');
    actor.stop();
  });

  it('データ損失リスクあり → 即座にエスカレーション確定', () => {
    const actor = startMachine();
    advanceThroughStep1(actor, makeAnalysis({ hasDataLossRisk: true }));

    expect(actor.getSnapshot().value).toEqual({
      escalationJudgment: 'executeImmediate',
    });

    actor.send({ type: 'ESCALATION_DECIDED' });
    expect(actor.getSnapshot().context.escalationResult).toBe('escalate');
    actor.stop();
  });
});

// =============================================================================
// INV-ES3: エスカレーション判断の結果は「実施」or「自力」の2つのみ
// =============================================================================

describe('INV-ES3: ESの結果は「エスカレーション実施」or「自力で対応」の2つのみ', () => {
  it('ESのfinal状態がescalationConfirmedとselfResolutionの2つのみ', () => {
    const esStates = (
      recoveryFlowMachine.config.states?.escalationJudgment as {
        states?: Record<string, { type?: string }>;
      }
    )?.states;

    expect(esStates).toBeDefined();
    if (esStates) {
      const finalStates = Object.entries(esStates)
        .filter(([, config]) => config.type === 'final')
        .map(([name]) => name);
      expect(finalStates).toHaveLength(2);
      expect(finalStates).toContain('escalationConfirmed');
      expect(finalStates).toContain('selfResolution');
    }
  });

  it('ES-ESC → consultTeamに遷移する', () => {
    const actor = startMachine();
    // retreatCount=3 で ES-GW2 ヒット → consider30Min → ESCALATION_DECIDED → ESC
    advanceThroughStep1(actor, makeAnalysis({ retreatCount: 3 }));

    expect(actor.getSnapshot().value).toEqual({
      escalationJudgment: 'consider30Min',
    });

    actor.send({ type: 'ESCALATION_DECIDED' });
    expect(actor.getSnapshot().value).toBe('consultTeam');
    actor.stop();
  });

  it('ES-SELF → approachSelectionに遷移する（ループ脱出で確認）', () => {
    // ES-SELF後にapproachSelectionに戻ることを、
    // 2回目のapproachSelectionでアプローチAに切り替えて確認する
    let callCount = 0;
    const machine = recoveryFlowMachine.provide({
      actions: {
        selectApproach: assign({
          selectedApproach: (): RecoveryFlowContext['selectedApproach'] => {
            callCount++;
            return callCount > 1 ? 'A' : null;
          },
        }),
      },
    });
    const actor = createActor(machine);
    actor.start();

    // 全フラグoff → ES-SELF
    advanceThroughStep1(actor, makeAnalysis());
    // 1回目: null → D → ES → SELF → approachSelection
    // 2回目: 'A' → directResolution
    expect(actor.getSnapshot().value).toEqual({
      directResolution: 'humanDirectFix',
    });
    // ES-SELFを経由してapproachSelectionに戻り、2回目でAに遷移した
    actor.stop();
  });
});

// =============================================================================
// 補足: フルパステスト（Step 1 → Step 2 → Step 3 → 完了）
// =============================================================================

describe('フルパス: Step 1からrecoveryCompleteまでの完全フロー', () => {
  it('アプローチB全通過フロー', () => {
    const actor = startWithApproach('B');

    // Step 1
    actor.send({ type: 'PROBLEM_VERBALIZED' });
    actor.send({ type: 'CAUSE_ANALYZED' });
    actor.send({ type: 'ESSENCE_IDENTIFIED', analysisResult: makeAnalysis() });

    // Step 2
    actor.send({ type: 'REDECOMPOSE_COMPLETE' });

    // Step 3
    actor.send({ type: 'CLAUDE_MD_RECORDED' });
    actor.send({ type: 'WORKAROUND_DOCUMENTED' });

    // 完了
    expect(actor.getSnapshot().value).toBe('recoveryComplete');
    expect(actor.getSnapshot().status).toBe('done');
    expect(actor.getSnapshot().output).toEqual({ recovered: true });
    actor.stop();
  });

  it('GW1エスカレーション → 全通過フロー', () => {
    const actor = startMachine();

    // Step 1（セキュリティ問題あり）
    advanceThroughStep1(actor, makeAnalysis({ hasSecurityIssue: true }));

    // ES → executeImmediate → ESC → consultTeam
    actor.send({ type: 'ESCALATION_DECIDED' });
    actor.send({ type: 'TEAM_CONSULTED' });

    // Step 3
    actor.send({ type: 'CLAUDE_MD_RECORDED' });
    actor.send({ type: 'WORKAROUND_DOCUMENTED' });

    expect(actor.getSnapshot().value).toBe('recoveryComplete');
    expect(actor.getSnapshot().output).toEqual({ recovered: true });
    actor.stop();
  });
});
