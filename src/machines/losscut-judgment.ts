/**
 * T12: 損切り判断（LC）ステートマシン
 *
 * 1文説明: T7の仕様に基づき、損切り判断（4条件OR＋短絡評価）を
 *          XState v5の状態チェーンで実装し、INV-LC1〜LC5が通るテストを書く
 *
 * 出典: docs/spec-verification-losscut.md §4
 * 設計判断#1: 状態チェーン方式（短絡評価を構造で保証）
 *
 * 構造:
 *   recordErrorState (initial) → check3Times → check30Min
 *     → checkComplexity → checkRecurrence → continueFix (final)
 *                ↘            ↘            ↘            ↘
 *                         lossCutConfirmed (final)
 */

import { setup, assign } from 'xstate';
import type {
  LossCutContext,
  LossCutEvent,
  LossCutOutput,
  LossCutDecision,
} from './types';

// =============================================================================
// ガード関数（純粋関数）— verification-loop.ts からも再利用
// =============================================================================

/** LC-GW1: 同一エラー3回以上（§4.4） */
export function checkErrorCount3OrMore(ctx: LossCutContext): boolean {
  return ctx.errorCount >= 3;
}

/** LC-GW2: 30分経過（§4.4） */
export function checkOver30Min(ctx: LossCutContext): boolean {
  return Date.now() - ctx.startedAt >= 1800000;
}

/** LC-GW3: コード複雑度の増加（§4.4） */
export function checkGrowingComplexity(ctx: LossCutContext): boolean {
  const latest = ctx.errorHistory[ctx.errorHistory.length - 1];
  return latest?.complexityDelta === 'increased';
}

/**
 * LC-GW4: 同一エラーの再発（§4.4）
 *
 * 実装判断: 仕様書の擬似コードでは errorHistory.some() で全件チェックしているが、
 * recordError アクション（SP-3側）で現在のエラーが既に errorHistory に追加済みのため、
 * 最後のエントリ（現在のエラー）を除外して過去のレコードのみを検索する。
 * これにより「過去修正済みの同一エラーが再発した」の意味を正確に表現する。
 */
export function checkRecurringError(ctx: LossCutContext): boolean {
  if (!ctx.lastError) return false;
  const current = ctx.lastError;
  return ctx.errorHistory.slice(0, -1).some(
    (record) =>
      record.error.message === current.message &&
      record.error.step === current.step
  );
}

// =============================================================================
// 単体テスト用マシン定義
// =============================================================================

export const lossCutJudgmentMachine = setup({
  types: {
    context: {} as LossCutContext,
    events: {} as LossCutEvent,
    output: {} as LossCutOutput,
  },
  guards: {
    /** §4.4: LC-GW1 — INV-LC2, INV-LC4, INV-LC5 */
    isErrorCount3OrMore: ({ context }) => checkErrorCount3OrMore(context),
    /** §4.4: LC-GW2 — INV-LC2, INV-LC4, INV-LC5 */
    isOver30Min: ({ context }) => checkOver30Min(context),
    /** §4.4: LC-GW3 — INV-LC2, INV-LC4 */
    isGrowingComplexity: ({ context }) => checkGrowingComplexity(context),
    /** §4.4: LC-GW4 — INV-LC2, INV-LC4 */
    isRecurringError: ({ context }) => checkRecurringError(context),
  },
  actions: {
    /** §4.5: LC-T1 エラー状態の記録 */
    recordCurrentErrorState: () => {
      /* エラー状態記録ロジック: 外部から注入 */
    },
  },
}).createMachine({
  id: 'lossCutJudgment',
  initial: 'recordErrorState',
  context: {
    errorCount: 0,
    startedAt: Date.now(),
    lastError: null,
    errorHistory: [],
    lossCutDecision: null,
  },

  states: {
    // --- LC-T1: エラー状態の記録（INV-LC1: 損切り判定前に必ず実行）---
    // §4.2: initial状態、§4.6: 遷移表 行1
    recordErrorState: {
      entry: [{ type: 'recordCurrentErrorState' }],
      on: {
        ERROR_STATE_RECORDED: { target: 'check3Times' },
      },
    },

    // --- LC-GW1: 3回ルール判定（INV-LC4: 短絡評価の第1条件）---
    // §4.6: 遷移表 行2-3
    check3Times: {
      always: [
        {
          guard: 'isErrorCount3OrMore',
          actions: assign({
            lossCutDecision: () => 'cut' as LossCutDecision,
          }),
          target: 'lossCutConfirmed',
        },
        { target: 'check30Min' },
      ],
    },

    // --- LC-GW2: 時間ルール判定（INV-LC4: 短絡評価の第2条件）---
    // §4.6: 遷移表 行4-5
    check30Min: {
      always: [
        {
          guard: 'isOver30Min',
          actions: assign({
            lossCutDecision: () => 'cut' as LossCutDecision,
          }),
          target: 'lossCutConfirmed',
        },
        { target: 'checkComplexity' },
      ],
    },

    // --- LC-GW3: 複雑化ルール判定（INV-LC4: 短絡評価の第3条件）---
    // §4.6: 遷移表 行6-7
    checkComplexity: {
      always: [
        {
          guard: 'isGrowingComplexity',
          actions: assign({
            lossCutDecision: () => 'cut' as LossCutDecision,
          }),
          target: 'lossCutConfirmed',
        },
        { target: 'checkRecurrence' },
      ],
    },

    // --- LC-GW4: 再発ルール判定（INV-LC4: 短絡評価の第4条件）---
    // §4.6: 遷移表 行8-9
    checkRecurrence: {
      always: [
        {
          guard: 'isRecurringError',
          actions: assign({
            lossCutDecision: () => 'cut' as LossCutDecision,
          }),
          target: 'lossCutConfirmed',
        },
        {
          actions: assign({
            lossCutDecision: () => 'continue' as LossCutDecision,
          }),
          target: 'continueFix',
        },
      ],
    },

    // --- 最終状態 ---
    // LC-EE-CONT: 修正継続（INV-LC3）
    continueFix: { type: 'final' },
    // LC-EE-CUT: 損切り確定（INV-LC2）
    lossCutConfirmed: { type: 'final' },
  },

  // §4.7: LCの出力（設計判断#7: outputプロパティ方式）
  output: ({ context }) => ({
    decision: context.lossCutDecision ?? 'continue',
  }),
});
