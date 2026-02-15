/**
 * T9: L0-L4 階層ステートマシン（SP-1: L0-L3チェック）
 *
 * 1文説明: T5の仕様に基づき、L0→L1→L2→L3の4層逐次チェックを
 *          XState v5で実装し、INV-H1〜H5/INV-SP1-1〜SP1-5が通るテストを書く
 *
 * 出典: docs/spec-l0l4-hierarchy.md
 * 命名規則:
 *   - 状態名: camelCase（設計判断#9）
 *   - イベント名: SCREAMING_SNAKE（設計判断#8）
 *   - ガード名: camelCase（設計判断#10）
 *   - 出力方式: outputプロパティ（設計判断#7）
 */

import { setup, assign } from 'xstate';
import type {
  LevelResult,
  L0L3CheckContext,
  L0L3CheckEvent,
  L0L3CheckOutput,
} from './types';

/**
 * SP-1（L0-L3チェック）マシン定義
 *
 * 構造:
 *   l0Check (initial) → l1Check → l2Check → l3Check → passed (final)
 *                 ↘         ↘         ↘         ↘
 *                              failed (final)
 *
 * 仕様書参照:
 *   - §3.3: 状態定義（6状態）
 *   - §3.4: イベント定義（4イベント）
 *   - §3.5: ガード条件（4ガード）
 *   - §3.6: アクション定義（8アクション）
 *   - §3.7: 遷移表
 */
export const l0l3CheckMachine = setup({
  types: {
    context: {} as L0L3CheckContext,
    events: {} as L0L3CheckEvent,
    output: {} as L0L3CheckOutput,
  },
  guards: {
    /**
     * §3.5: ガード条件定義
     * 各ガードはevent.resultを参照する（assignアクション実行前のため、contextはまだ更新されていない）
     *
     * 注意: XState v5ではガード配列の評価順序が保証されており、
     *       最初にtrueとなったガードの遷移が採用される（DT-1ヒットポリシーF対応）
     */
    isL0Pass: ({ event }) => {
      const e = event as { type: 'L0_EVALUATION_COMPLETE'; result: LevelResult };
      return e.result.passed === true;
    },
    isL1Pass: ({ event }) => {
      const e = event as { type: 'L1_EVALUATION_COMPLETE'; result: LevelResult };
      return e.result.passed === true;
    },
    isL2Pass: ({ event }) => {
      const e = event as { type: 'L2_EVALUATION_COMPLETE'; result: LevelResult };
      return e.result.passed === true;
    },
    isL3Pass: ({ event }) => {
      const e = event as { type: 'L3_EVALUATION_COMPLETE'; result: LevelResult };
      return e.result.passed === true;
    },
  },
  actions: {
    /**
     * §3.6: アクション定義
     * evaluateLx: entry アクション（DT-2〜DT-5の評価ロジック）
     *   → 実際の評価ロジックは外部から注入される想定
     *   → マシン定義としてはプレースホルダー
     */
    evaluateL0: () => {
      /* DT-2 評価ロジック: 外部から注入 */
    },
    evaluateL1: () => {
      /* DT-3 評価ロジック: 外部から注入 */
    },
    evaluateL2: () => {
      /* DT-4 評価ロジック: 外部から注入 */
    },
    evaluateL3: () => {
      /* DT-5 評価ロジック: 外部から注入 */
    },
  },
}).createMachine({
  id: 'l0l3Check',
  initial: 'l0Check',
  context: {
    evaluationResults: { l0: null, l1: null, l2: null, l3: null },
  },

  states: {
    // --- L0 持続可能性チェック（DT-2: G1-G3, R1-R3）---
    // §3.3: 通常状態（initial）、§3.7: 遷移表 行1-2
    l0Check: {
      entry: [{ type: 'evaluateL0' }],
      on: {
        L0_EVALUATION_COMPLETE: [
          {
            guard: 'isL0Pass',
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l0: event.result,
              }),
            }),
            target: 'l1Check',
          },
          {
            // フォールバック: isL0Pass === false → failed
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l0: event.result,
              }),
            }),
            target: 'failed',
          },
        ],
      },
    },

    // --- L1 心理的安全性チェック（DT-3: P1-P3）---
    // §3.3: 通常状態、§3.7: 遷移表 行3-4
    l1Check: {
      entry: [{ type: 'evaluateL1' }],
      on: {
        L1_EVALUATION_COMPLETE: [
          {
            guard: 'isL1Pass',
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l1: event.result,
              }),
            }),
            target: 'l2Check',
          },
          {
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l1: event.result,
              }),
            }),
            target: 'failed',
          },
        ],
      },
    },

    // --- L2 急がば回れチェック（DT-4: H1-H3）---
    // §3.3: 通常状態、§3.7: 遷移表 行5-6
    l2Check: {
      entry: [{ type: 'evaluateL2' }],
      on: {
        L2_EVALUATION_COMPLETE: [
          {
            guard: 'isL2Pass',
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l2: event.result,
              }),
            }),
            target: 'l3Check',
          },
          {
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l2: event.result,
              }),
            }),
            target: 'failed',
          },
        ],
      },
    },

    // --- L3 シンプルさチェック（DT-5: S1-S3 + YAGNI）---
    // §3.3: 通常状態、§3.7: 遷移表 行7-8
    l3Check: {
      entry: [{ type: 'evaluateL3' }],
      on: {
        L3_EVALUATION_COMPLETE: [
          {
            guard: 'isL3Pass',
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l3: event.result,
              }),
            }),
            target: 'passed',
          },
          {
            actions: assign({
              evaluationResults: ({ context, event }) => ({
                ...context.evaluationResults,
                l3: event.result,
              }),
            }),
            target: 'failed',
          },
        ],
      },
    },

    // --- 最終状態 ---
    // §3.3: passed = SP1-EE-OK, failed = SP1-EE-NG
    passed: { type: 'final' },
    failed: { type: 'final' },
  },

  // §4.2: SP-1の結果をoutputで親に通知（設計判断#7）
  output: ({ context }) => ({
    result: context.evaluationResults,
    allPassed: Object.values(context.evaluationResults).every(
      (r) => r?.passed === true
    ),
  }),
});
