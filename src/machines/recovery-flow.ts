/**
 * T13: 復帰フロー（RF）＋ エスカレーション判断（ES）ステートマシン
 *
 * 1文説明: T8の仕様に基づき、RF（分析→アプローチ選択→CLAUDE.md記録→復帰）と
 *          ES（即座/30分以内の2段階判定）をXState v5で実装し、
 *          INV-RF1〜RF6とINV-ES1〜ES3が通るテストを書く
 *
 * 出典: docs/spec-recovery-escalation.md §3, §4, §6, §8
 * 設計判断#1: ESはRF内のcompound state（T7のLC方式と同一パターン）
 * 設計判断#3: 各アプローチからrecordToClaudeMdへの直接遷移（合流パターン）
 *
 * 実装判断: ES output方式
 *   仕様書§4.7では self.getSnapshot().matches() を使用しているが、
 *   T11で判明したXState v5の制約（output関数内でのself参照）のため、
 *   context.escalationResult ベースで判定する方式に変更（T11と同じ対処）。
 *
 * 構造:
 *   problemAnalysis (initial, compound)
 *     verbalizeProblem → analyzeCause → identifyEssence
 *   → escalationCheck (RF-GW1)
 *     → escalationJudgment (ES) or approachSelection
 *   → approachSelection (RF-GW2)
 *     → directResolution(A) / redecompose(B) / resetContext(C) / escalationJudgment(D)
 *   → recordToClaudeMd (RF-T9: 必須合流点)
 *   → documentWorkaround (RF-T10)
 *   → teamShareDecision (RF-GW3)
 *   → recoveryComplete (final)
 */

import { setup, assign } from 'xstate';
import type {
  RecoveryFlowContext,
  RecoveryFlowEvent,
  RecoveryFlowOutput,
  ProblemAnalysis,
  EscalationResult,
} from './types';

// =============================================================================
// ガード関数（純粋関数）
// =============================================================================

/**
 * RF-GW1 / ES-GW1 共通ロジック:
 * セキュリティ問題・本番影響・データ損失リスクのいずれかに該当するか（§3.5, §4.4）
 *
 * 別名ガード（needsImmediateEscalation / isSecurityOrProductionOrDataLoss）で共有。
 * 仕様書の2段階構造（RF-GW1はESに入る前のファストパス）を維持するため、
 * ガード名は別名で定義し、内部でこの関数を呼ぶ（設計判断: 別名維持）。
 */
export function checkImmediateEscalationNeeded(
  analysisResult: ProblemAnalysis | null,
): boolean {
  if (!analysisResult) return false;
  return (
    analysisResult.hasSecurityIssue ||
    analysisResult.hasProductionImpact ||
    analysisResult.hasDataLossRisk
  );
}

/**
 * ES-GW2: 30分以内にエスカレーション検討すべきか（§4.4）
 * 3回撤退・原因不明・スキル範囲外のいずれかに該当するか
 */
export function checkDelayedEscalationNeeded(
  analysisResult: ProblemAnalysis | null,
): boolean {
  if (!analysisResult) return false;
  return (
    analysisResult.retreatCount >= 3 ||
    analysisResult.isUnknownCause ||
    analysisResult.isOutOfSkillScope
  );
}

// =============================================================================
// マシン定義
// =============================================================================

export const recoveryFlowMachine = setup({
  types: {
    context: {} as RecoveryFlowContext,
    events: {} as RecoveryFlowEvent,
    output: {} as RecoveryFlowOutput,
  },
  guards: {
    // --- RF ガード（§3.5）---
    /** RF-GW1: 即座にエスカレーションが必要か — INV-RF5 */
    needsImmediateEscalation: ({ context }) =>
      checkImmediateEscalationNeeded(context.analysisResult),
    /** RF-GW2: アプローチA — INV-RF6 */
    isApproachA: ({ context }) => context.selectedApproach === 'A',
    /** RF-GW2: アプローチB — INV-RF6 */
    isApproachB: ({ context }) => context.selectedApproach === 'B',
    /** RF-GW2: アプローチC — INV-RF6 */
    isApproachC: ({ context }) => context.selectedApproach === 'C',
    // isApproachD はフォールバックのため明示的ガード不要
    /** RF-GW3: チーム共有すべきか */
    shouldShareWithTeam: ({ context }) => context.shouldShareWithTeam === true,

    // --- ES ガード（§4.4 — 別名維持、内部で共通関数を呼ぶ）---
    /** ES-GW1: セキュリティ/本番影響/データ損失 — INV-ES1, INV-ES2 */
    isSecurityOrProductionOrDataLoss: ({ context }) =>
      checkImmediateEscalationNeeded(context.analysisResult),
    /** ES-GW2: 3回撤退/原因不明/スキル範囲外 — INV-ES1 */
    isRetreat3TimesOrUnknownOrOutOfScope: ({ context }) =>
      checkDelayedEscalationNeeded(context.analysisResult),

    // --- ES onDone ガード（contextベース、T11踏襲）---
    /** ESの結果がエスカレーション確定か — INV-ES3 */
    isEscalationConfirmed: ({ context }) =>
      context.escalationResult === 'escalate',
  },
  actions: {
    // --- Step 1: 問題分析アクション（§3.6）---
    verbalizeProblem: () => {
      /* 問題言語化ロジック: 外部から注入 */
    },
    analyzeCause: () => {
      /* 原因分析ロジック: 外部から注入 */
    },
    identifyEssence: () => {
      /* 本質特定ロジック: 外部から注入 */
    },

    // --- Step 2: アプローチ選択・実行アクション（§3.6）---
    /**
     * アプローチ選択: §3.6でassign種別として定義。
     * ベースマシンではno-op。テスト時にprovide()でassignアクションを注入し、
     * selectedApproachをcontextに設定する。
     */
    selectApproach: () => {
      /* アプローチ選択ロジック: 外部から注入 */
    },
    humanDirectFix: () => {
      /* 人間直接解決ロジック: 外部から注入 */
    },
    askAiExplanation: () => {
      /* AI説明取得ロジック: 外部から注入 */
    },
    redecomposeProblem: () => {
      /* 問題再分解ロジック: 外部から注入 */
    },
    resetContext: () => {
      /* コンテキストリセットロジック: 外部から注入 */
    },
    consultTeam: () => {
      /* チーム相談ロジック: 外部から注入 */
    },

    // --- ES アクション（§4.5）---
    executeImmediateEscalation: () => {
      /* 即座エスカレーション: 外部から注入 */
    },
    considerEscalation: () => {
      /* 30分以内エスカレーション検討: 外部から注入 */
    },

    // --- Step 3: 学習記録アクション（§3.6）---
    recordFailurePattern: () => {
      /* CLAUDE.md記録ロジック: 外部から注入 */
    },
    documentWorkaround: () => {
      /* 回避策文書化ロジック: 外部から注入 */
    },
    shareWithTeam: () => {
      /* チーム共有ロジック: 外部から注入 */
    },
  },
}).createMachine({
  id: 'recoveryFlow',
  initial: 'problemAnalysis',
  context: {
    lastError: null,
    errorHistory: [],
    analysisResult: null,
    selectedApproach: null,
    escalationResult: null,
    failureRecord: null,
    shouldShareWithTeam: false,
  },

  states: {
    // ========================================
    // Step 1: 問題分析（compound state, initial）
    // INV-RF1: RFの最初のステップとして必ず実行
    // ========================================
    problemAnalysis: {
      initial: 'verbalizeProblem',
      states: {
        // RF-T1: 問題を言語化する（INV-RF1: 最初のステップ）
        // §3.7: 遷移表 行1
        verbalizeProblem: {
          entry: [{ type: 'verbalizeProblem' }],
          on: {
            PROBLEM_VERBALIZED: 'analyzeCause',
          },
        },

        // RF-T2: 原因を分析する
        // §3.7: 遷移表 行2
        analyzeCause: {
          entry: [{ type: 'analyzeCause' }],
          on: {
            CAUSE_ANALYZED: 'identifyEssence',
          },
        },

        // RF-T3: 本質を特定する
        // §3.7: 遷移表 行3
        identifyEssence: {
          entry: [{ type: 'identifyEssence' }],
          on: {
            ESSENCE_IDENTIFIED: {
              actions: assign({
                analysisResult: ({ event }) => {
                  const e = event as {
                    type: 'ESSENCE_IDENTIFIED';
                    analysisResult: ProblemAnalysis;
                  };
                  return e.analysisResult;
                },
              }),
              target: '#recoveryFlow.escalationCheck', // INV-RF5
            },
          },
        },
      },
    },

    // ========================================
    // RF-GW1: エスカレーション要否判定（INV-RF5）
    // §3.7: 遷移表 行4-5
    // ========================================
    escalationCheck: {
      always: [
        {
          guard: 'needsImmediateEscalation',
          target: 'escalationJudgment', // INV-RF5
        },
        {
          target: 'approachSelection', // INV-RF5
        },
      ],
    },

    // ========================================
    // ES: エスカレーション判断（compound state）
    // INV-ES1〜ES3
    // §4: ES詳細仕様
    // ========================================
    escalationJudgment: {
      initial: 'checkImmediate',
      states: {
        // ES-GW1: 即座にエスカレーション必要？（INV-ES1: 最初の判定）
        // §4.6: 遷移表 行1-2
        checkImmediate: {
          always: [
            {
              guard: 'isSecurityOrProductionOrDataLoss',
              target: 'executeImmediate', // INV-ES2
            },
            {
              target: 'check30Min', // INV-ES1
            },
          ],
        },

        // ES-T1: 即座にエスカレーションを実施（INV-ES2: 遅延不可）
        // §4.6: 遷移表 行3
        executeImmediate: {
          entry: [{ type: 'executeImmediateEscalation' }],
          on: {
            ESCALATION_DECIDED: {
              actions: assign({
                escalationResult: () => 'escalate' as EscalationResult,
              }),
              target: 'escalationConfirmed', // INV-ES3
            },
          },
        },

        // ES-GW2: 30分以内にエスカレーション検討すべき？
        // §4.6: 遷移表 行4-5
        check30Min: {
          always: [
            {
              guard: 'isRetreat3TimesOrUnknownOrOutOfScope',
              target: 'consider30Min',
            },
            {
              actions: assign({
                escalationResult: () => 'self' as EscalationResult,
              }),
              target: 'selfResolution', // INV-ES3
            },
          ],
        },

        // ES-T2: 30分以内にエスカレーションを検討する
        // §4.6: 遷移表 行6
        consider30Min: {
          entry: [{ type: 'considerEscalation' }],
          on: {
            ESCALATION_DECIDED: {
              actions: assign({
                escalationResult: () => 'escalate' as EscalationResult,
              }),
              target: 'escalationConfirmed', // INV-ES3
            },
          },
        },

        // ES-EE-ESC: エスカレーション実施
        escalationConfirmed: { type: 'final' },

        // ES-EE-SELF: 自力で対応
        selfResolution: { type: 'final' },
      },

      // ES完了時の分岐（contextベース、T11踏襲）
      // §3.7: 遷移表 行6-7
      onDone: [
        {
          guard: 'isEscalationConfirmed',
          target: 'consultTeam', // ESC → チーム相談
        },
        {
          target: 'approachSelection', // SELF → アプローチ再選択
        },
      ],
    },

    // ========================================
    // RF-GW2: アプローチ選択（INV-RF6: 4パターン排他）
    // §3.7: 遷移表 行8-11, §3.9
    // ========================================
    approachSelection: {
      entry: [{ type: 'selectApproach' }],
      always: [
        {
          guard: 'isApproachA',
          target: 'directResolution', // INV-RF6: A
        },
        {
          guard: 'isApproachB',
          target: 'redecompose', // INV-RF6: B
        },
        {
          guard: 'isApproachC',
          target: 'resetContext', // INV-RF6: C
        },
        {
          target: 'escalationJudgment', // INV-RF6: D（フォールバック）
        },
      ],
    },

    // ========================================
    // Step 2: アプローチ実行
    // ========================================

    // --- A: 直接解決（RF-T4 + RF-T5）---
    // §3.7: 遷移表 行12-13
    directResolution: {
      initial: 'humanDirectFix',
      states: {
        // RF-T4: 人間が直接問題を解決する
        humanDirectFix: {
          entry: [{ type: 'humanDirectFix' }],
          on: {
            HUMAN_FIX_COMPLETE: 'askAiExplanation',
          },
        },
        // RF-T5: AIに問題の説明と解決策を求める
        askAiExplanation: {
          entry: [{ type: 'askAiExplanation' }],
          on: {
            AI_EXPLANATION_RECEIVED: {
              target: '#recoveryFlow.recordToClaudeMd', // INV-RF2: 合流
            },
          },
        },
      },
    },

    // --- B: 再分解（RF-T6）---
    // §3.7: 遷移表 行14
    redecompose: {
      entry: [{ type: 'redecomposeProblem' }],
      on: {
        REDECOMPOSE_COMPLETE: 'recordToClaudeMd', // INV-RF2: 合流
      },
    },

    // --- C: リセット（RF-T7）---
    // §3.7: 遷移表 行15
    resetContext: {
      entry: [{ type: 'resetContext' }],
      on: {
        CONTEXT_RESET_COMPLETE: 'recordToClaudeMd', // INV-RF2: 合流
      },
    },

    // --- D後のチーム相談（RF-T8）---
    // §3.7: 遷移表 行16
    consultTeam: {
      entry: [{ type: 'consultTeam' }],
      on: {
        TEAM_CONSULTED: 'recordToClaudeMd', // INV-RF2: 合流
      },
    },

    // ========================================
    // Step 3: 学習記録（必須）
    // ========================================

    // --- RF-T9: CLAUDE.mdに追記する（INV-RF2: 全パスの必須合流点）---
    // §3.7: 遷移表 行17
    recordToClaudeMd: {
      entry: [{ type: 'recordFailurePattern' }],
      on: {
        CLAUDE_MD_RECORDED: 'documentWorkaround', // INV-RF3
      },
    },

    // --- RF-T10: 回避策を文書化する（INV-RF3: RF-T9の後に必ず実行）---
    // §3.7: 遷移表 行18
    documentWorkaround: {
      entry: [{ type: 'documentWorkaround' }],
      on: {
        WORKAROUND_DOCUMENTED: 'teamShareDecision',
      },
    },

    // --- RF-GW3: チーム共有判断 ---
    // §3.7: 遷移表 行19-20
    teamShareDecision: {
      always: [
        {
          guard: 'shouldShareWithTeam',
          target: 'shareWithTeam',
        },
        {
          target: 'recoveryComplete', // INV-RF4
        },
      ],
    },

    // --- RF-T11: チームに共有する ---
    // §3.7: 遷移表 行21
    shareWithTeam: {
      entry: [{ type: 'shareWithTeam' }],
      on: {
        TEAM_SHARED: 'recoveryComplete', // INV-RF4
      },
    },

    // ========================================
    // RF-EE: 復帰完了（INV-RF4: SE-1に復帰）
    // ========================================
    recoveryComplete: { type: 'final' },
  },

  // §3.8: RFのoutput（設計判断#7: outputプロパティ方式）
  output: () => ({
    recovered: true,
  }),
});
