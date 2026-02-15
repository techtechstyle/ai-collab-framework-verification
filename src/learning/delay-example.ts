/**
 * T3 学習サンプル②: 遅延遷移（Delayed Transition）
 *
 * 目的:
 *   損切りルールの30分タイマー（INV-LC2, INV-LC5）を、
 *   XState v5の遅延遷移（after）で実現する方法を理解する。
 *
 * フレームワーク対応:
 *   - INV-LC2: 30分経過で損切り確定
 *   - INV-LC5: SP3-IE1（30分経過イベント）が損切り判断を強制起動
 *   - INV-LC4: 3回ルール（カウンタベース — 遅延遷移ではなく context + guard で実装）
 *
 * 学習ポイント:
 *   1. after による遅延遷移の基本
 *   2. context を使ったカウンタ管理との組合せ
 *   3. Vitest の vi.useFakeTimers() による時間制御テスト
 */

import { createMachine, createActor, assign } from 'xstate';

// ============================================================
// サンプル1: 基本的な遅延遷移（30分タイマー）
// ============================================================
//
// シナリオ:
//   fixing 状態でエラー修正中に30分（1,800,000ms）が経過すると
//   自動的に lossCut 状態に遷移する。
//   修正が成功すれば（CHECK_PASS）fixed に遷移して終了。
//
// フレームワーク対応:
//   fixing = SP3内のエラー修正状態
//   lossCut = LC-EE-CUT（損切り確定）
//   fixed = SP3-EE-OK（検証成功）

export const THIRTY_MINUTES_MS = 30 * 60 * 1000; // 1,800,000ms

export const delayBasicMachine = createMachine({
  id: 'delayBasic',
  initial: 'fixing',
  states: {
    fixing: {
      after: {
        // 30分経過で自動的に lossCut へ遷移（INV-LC2, INV-LC5）
        [THIRTY_MINUTES_MS]: 'lossCut',
      },
      on: {
        CHECK_PASS: 'fixed',
      },
    },
    fixed: { type: 'final' },
    lossCut: { type: 'final' },
  },
});

// ============================================================
// サンプル2: 遅延遷移 + カウンタ（3回ルールとの組合せ）
// ============================================================
//
// シナリオ:
//   エラー修正のたびに errorCount を+1。
//   3回に達したら即座に損切り（INV-LC4: 短絡評価）。
//   3回未満でも30分経過で損切り（INV-LC2）。
//   成功すればいつでも fixed に遷移可能。
//
// フレームワーク対応:
//   fixing = SP3内のエラー修正状態
//   context.errorCount = LC-T1で記録するエラー回数
//   CHECK_FAIL → errorCount++ → 3回でlossCut

export const delayCombinedMachine = createMachine({
  id: 'delayCombined',
  initial: 'fixing',
  context: {
    errorCount: 0,
  },
  states: {
    fixing: {
      after: {
        // 30分タイマー（INV-LC2）
        [THIRTY_MINUTES_MS]: 'lossCut',
      },
      on: {
        CHECK_PASS: 'fixed',
        CHECK_FAIL: [
          {
            // 3回目のエラーで即座に損切り（INV-LC4: 短絡評価）
            guard: ({ context }) => context.errorCount >= 2,
            target: 'lossCut',
            actions: assign({
              errorCount: ({ context }) => context.errorCount + 1,
            }),
          },
          {
            // 3回未満: カウントを増やして修正継続
            actions: assign({
              errorCount: ({ context }) => context.errorCount + 1,
            }),
          },
        ],
      },
    },
    fixed: { type: 'final' },
    lossCut: { type: 'final' },
  },
});
