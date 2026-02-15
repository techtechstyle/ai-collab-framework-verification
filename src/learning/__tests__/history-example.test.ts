/**
 * T3 テスト①: 履歴状態（History State）の動作確認
 *
 * 検証内容:
 *   1. shallow history で直近の子状態に復帰する
 *   2. deep history でネスト先の子状態に復帰する
 *   3. shallow vs deep の違いが明確であること
 */

import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  shallowHistoryMachine,
  deepHistoryMachine,
  shallowNestedMachine,
} from '../history-example.js';

// ヘルパー: イベント列を送信して最終的な状態値を返す
function runEvents(machine: Parameters<typeof createActor>[0], events: string[]) {
  const actor = createActor(machine);
  actor.start();
  for (const event of events) {
    actor.send({ type: event });
  }
  const value = actor.getSnapshot().value;
  actor.stop();
  return value;
}

describe('サンプル1: shallow history（フラット構造）', () => {
  it('step2 にいるときに INTERRUPT → RESUME で step2 に戻る', () => {
    const result = runEvents(shallowHistoryMachine, [
      'NEXT',       // step1 → step2
      'INTERRUPT',  // step2 → interrupted
      'RESUME',     // interrupted → processing.hist → step2
    ]);

    // processing 内の step2 に復帰しているはず
    expect(result).toEqual({ processing: 'step2' });
  });

  it('step3 にいるときに INTERRUPT → RESUME で step3 に戻る', () => {
    const result = runEvents(shallowHistoryMachine, [
      'NEXT',       // step1 → step2
      'NEXT',       // step2 → step3
      'INTERRUPT',  // step3 → interrupted
      'RESUME',     // interrupted → processing.hist → step3
    ]);

    expect(result).toEqual({ processing: 'step3' });
  });

  it('INTERRUPT なしで正常完了する', () => {
    const result = runEvents(shallowHistoryMachine, [
      'NEXT',  // step1 → step2
      'NEXT',  // step2 → step3
      'NEXT',  // step3 → done → onDone → completed
    ]);

    expect(result).toBe('completed');
  });
});

describe('サンプル2: deep history（ネスト構造）', () => {
  it('phase.sub2 にいるときに INTERRUPT → RESUME で phase.sub2 に戻る', () => {
    const result = runEvents(deepHistoryMachine, [
      'NEXT',       // phase.sub1 → phase.sub2
      'INTERRUPT',  // phase.sub2 → interrupted
      'RESUME',     // interrupted → processing.hist(deep) → phase.sub2
    ]);

    // deep history: ネスト先の sub2 まで復帰する
    expect(result).toEqual({ processing: { phase: 'sub2' } });
  });

  it('phase.sub3 にいるときに INTERRUPT → RESUME で phase.sub3 に戻る', () => {
    const result = runEvents(deepHistoryMachine, [
      'NEXT',       // phase.sub1 → phase.sub2
      'NEXT',       // phase.sub2 → phase.sub3
      'INTERRUPT',  // phase.sub3 → interrupted
      'RESUME',     // interrupted → processing.hist(deep) → phase.sub3
    ]);

    expect(result).toEqual({ processing: { phase: 'sub3' } });
  });
});

describe('サンプル3: shallow history（ネスト構造）— deep との比較', () => {
  it('phase.sub2 にいるときに INTERRUPT → RESUME で phase の初期状態（sub1）に戻る', () => {
    const result = runEvents(shallowNestedMachine, [
      'NEXT',       // phase.sub1 → phase.sub2
      'INTERRUPT',  // phase.sub2 → interrupted
      'RESUME',     // interrupted → processing.hist(shallow) → phase（初期状態）
    ]);

    // shallow history: processing の直近の子状態 = phase を記憶。
    // ただし phase 内部の sub2 は記憶しないので、phase の初期状態（sub1）に戻る。
    expect(result).toEqual({ processing: { phase: 'sub1' } });
  });
});

describe('shallow vs deep の違いの確認', () => {
  it('同じ操作で復帰先が異なることを検証', () => {
    const events = [
      'NEXT',       // sub1 → sub2
      'INTERRUPT',  // → interrupted
      'RESUME',     // → hist で復帰
    ];

    const deepResult = runEvents(deepHistoryMachine, events);
    const shallowResult = runEvents(shallowNestedMachine, events);

    // deep: phase.sub2 に復帰
    expect(deepResult).toEqual({ processing: { phase: 'sub2' } });

    // shallow: phase.sub1（初期状態）に復帰
    expect(shallowResult).toEqual({ processing: { phase: 'sub1' } });

    // 両者は異なる
    expect(deepResult).not.toEqual(shallowResult);
  });
});
