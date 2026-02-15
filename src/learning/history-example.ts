/**
 * T3 学習サンプル①: 履歴状態（History State）
 *
 * 目的:
 *   復帰フロー（RF）完了後、損切り前にいたメインフローの状態に
 *   戻る仕組みを、XState v5の履歴状態で実現する方法を理解する。
 *
 * フレームワーク対応:
 *   - INV-RF4: 復帰フローは常にメインフローSE-1に戻る
 *   - 履歴状態を使えば「SE-1に戻る」ではなく「損切り前の文脈に復帰」が可能
 *   - Step Bの仕様定義で、どちらの方式を採用するか決定する
 *
 * 学習ポイント:
 *   1. shallow history — 直近の子状態のみ記憶
 *   2. deep history — ネストされた子状態まで記憶
 *   3. 両者の違いと使い分け
 */

import { createMachine, createActor } from 'xstate';

// ============================================================
// サンプル1: shallow history
// ============================================================
//
// シナリオ:
//   processing という親状態の中に step1 → step2 → step3 がある。
//   step2 にいるときに INTERRUPT が発生して interrupted に移る。
//   RESUME すると、shallow history により step2 に戻る。
//
// フレームワーク対応:
//   processing = メインフロー内の作業中
//   step1/2/3 = brightLinesCheck / l0l3Check / aiFirstCheck
//   interrupted = 復帰フロー（recoveryFlow）
//   INTERRUPT = LOSS_CUT（損切り発生）
//   RESUME = RECOVERY_COMPLETE（復帰完了）

export const shallowHistoryMachine = createMachine({
  id: 'shallowHistory',
  initial: 'processing',
  states: {
    processing: {
      initial: 'step1',
      states: {
        step1: {
          on: { NEXT: 'step2' },
        },
        step2: {
          on: { NEXT: 'step3' },
        },
        step3: {
          on: { NEXT: 'done' },
        },
        done: { type: 'final' },
        // shallow history ノード
        hist: {
          type: 'history',
          history: 'shallow',
        },
      },
      on: {
        // どの子状態からでも INTERRUPT で interrupted に移動
        INTERRUPT: 'interrupted',
      },
      onDone: 'completed',
    },
    interrupted: {
      on: {
        // RESUME で shallow history を経由して復帰
        RESUME: 'processing.hist',
      },
    },
    completed: {
      type: 'final',
    },
  },
});

// ============================================================
// サンプル2: deep history
// ============================================================
//
// シナリオ:
//   processing の中に phase というネスト状態があり、
//   phase の中に sub1 → sub2 → sub3 がある。
//   phase.sub2 にいるときに INTERRUPT → RESUME すると:
//     - shallow history: phase の初期状態（sub1）に戻る
//     - deep history: phase.sub2 に戻る
//
// フレームワーク対応:
//   processing = メインフロー
//   phase = SP-1（L0-L3チェック）
//   sub1/sub2/sub3 = L0 / L1 / L2 チェック
//   deep history なら「L1まで通過済みの状態」に復帰できる

export const deepHistoryMachine = createMachine({
  id: 'deepHistory',
  initial: 'processing',
  states: {
    processing: {
      initial: 'phase',
      states: {
        phase: {
          initial: 'sub1',
          states: {
            sub1: {
              on: { NEXT: 'sub2' },
            },
            sub2: {
              on: { NEXT: 'sub3' },
            },
            sub3: {
              on: { NEXT: 'subDone' },
            },
            subDone: { type: 'final' },
          },
          onDone: 'phaseDone',
        },
        phaseDone: { type: 'final' },
        // deep history ノード — ネスト先まで記憶
        hist: {
          type: 'history',
          history: 'deep',
        },
      },
      on: {
        INTERRUPT: 'interrupted',
      },
      onDone: 'completed',
    },
    interrupted: {
      on: {
        RESUME: 'processing.hist',
      },
    },
    completed: {
      type: 'final',
    },
  },
});

// ============================================================
// サンプル3: shallow history（ネスト構造での比較用）
// ============================================================
//
// deep history との違いを明確にするため、同じ構造で shallow を使う

export const shallowNestedMachine = createMachine({
  id: 'shallowNested',
  initial: 'processing',
  states: {
    processing: {
      initial: 'phase',
      states: {
        phase: {
          initial: 'sub1',
          states: {
            sub1: {
              on: { NEXT: 'sub2' },
            },
            sub2: {
              on: { NEXT: 'sub3' },
            },
            sub3: {
              on: { NEXT: 'subDone' },
            },
            subDone: { type: 'final' },
          },
          onDone: 'phaseDone',
        },
        phaseDone: { type: 'final' },
        // shallow history ノード — 直近の子状態のみ記憶
        hist: {
          type: 'history',
          history: 'shallow',
        },
      },
      on: {
        INTERRUPT: 'interrupted',
      },
      onDone: 'completed',
    },
    interrupted: {
      on: {
        RESUME: 'processing.hist',
      },
    },
    completed: {
      type: 'final',
    },
  },
});
