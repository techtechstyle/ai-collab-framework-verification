/**
 * T3 テスト②: 遅延遷移（Delayed Transition）の動作確認
 *
 * 検証内容:
 *   1. 30分経過で自動的に lossCut に遷移する
 *   2. 30分以内に CHECK_PASS すれば fixed に遷移する
 *   3. 3回のCHECK_FAILで即座に lossCut（カウンタ + 遅延の組合せ）
 *   4. vi.useFakeTimers() による時間制御テストの方法
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActor } from 'xstate';
import {
  delayBasicMachine,
  delayCombinedMachine,
  THIRTY_MINUTES_MS,
} from '../delay-example.js';

// ============================================================
// サンプル1: 基本的な遅延遷移のテスト
// ============================================================

describe('サンプル1: 基本的な遅延遷移（30分タイマー）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('30分経過で自動的に lossCut に遷移する（INV-LC2）', () => {
    const actor = createActor(delayBasicMachine);
    actor.start();

    // 初期状態: fixing
    expect(actor.getSnapshot().value).toBe('fixing');

    // 30分経過をシミュレート
    vi.advanceTimersByTime(THIRTY_MINUTES_MS);

    // lossCut に遷移しているはず
    expect(actor.getSnapshot().value).toBe('lossCut');
    actor.stop();
  });

  it('29分59秒ではまだ fixing のままである', () => {
    const actor = createActor(delayBasicMachine);
    actor.start();

    // 29分59秒経過
    vi.advanceTimersByTime(THIRTY_MINUTES_MS - 1000);

    // まだ fixing のはず
    expect(actor.getSnapshot().value).toBe('fixing');
    actor.stop();
  });

  it('30分以内に CHECK_PASS すれば fixed に遷移する', () => {
    const actor = createActor(delayBasicMachine);
    actor.start();

    // 15分経過後に成功
    vi.advanceTimersByTime(15 * 60 * 1000);
    actor.send({ type: 'CHECK_PASS' });

    // fixed に遷移
    expect(actor.getSnapshot().value).toBe('fixed');
    actor.stop();
  });
});

// ============================================================
// サンプル2: 遅延遷移 + カウンタのテスト
// ============================================================

describe('サンプル2: 遅延遷移 + カウンタ（3回ルール）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('3回の CHECK_FAIL で即座に lossCut（INV-LC4: 短絡評価）', () => {
    const actor = createActor(delayCombinedMachine);
    actor.start();

    // 1回目の失敗: errorCount = 1
    actor.send({ type: 'CHECK_FAIL' });
    expect(actor.getSnapshot().value).toBe('fixing');
    expect(actor.getSnapshot().context.errorCount).toBe(1);

    // 2回目の失敗: errorCount = 2
    actor.send({ type: 'CHECK_FAIL' });
    expect(actor.getSnapshot().value).toBe('fixing');
    expect(actor.getSnapshot().context.errorCount).toBe(2);

    // 3回目の失敗: errorCount = 3 → 即座に lossCut
    actor.send({ type: 'CHECK_FAIL' });
    expect(actor.getSnapshot().value).toBe('lossCut');
    expect(actor.getSnapshot().context.errorCount).toBe(3);

    actor.stop();
  });

  it('2回失敗しても30分以内に CHECK_PASS すれば fixed になる', () => {
    const actor = createActor(delayCombinedMachine);
    actor.start();

    // 2回失敗
    actor.send({ type: 'CHECK_FAIL' });
    actor.send({ type: 'CHECK_FAIL' });
    expect(actor.getSnapshot().context.errorCount).toBe(2);

    // 成功
    actor.send({ type: 'CHECK_PASS' });
    expect(actor.getSnapshot().value).toBe('fixed');

    actor.stop();
  });

  it('2回失敗 + 30分経過で lossCut（タイマー発動）', () => {
    const actor = createActor(delayCombinedMachine);
    actor.start();

    // 2回失敗（まだ3回未満なのでタイマー継続）
    actor.send({ type: 'CHECK_FAIL' });
    actor.send({ type: 'CHECK_FAIL' });
    expect(actor.getSnapshot().value).toBe('fixing');

    // 30分経過
    vi.advanceTimersByTime(THIRTY_MINUTES_MS);
    expect(actor.getSnapshot().value).toBe('lossCut');

    actor.stop();
  });

  it('失敗なしでも30分経過で lossCut', () => {
    const actor = createActor(delayCombinedMachine);
    actor.start();

    expect(actor.getSnapshot().context.errorCount).toBe(0);

    // 30分経過
    vi.advanceTimersByTime(THIRTY_MINUTES_MS);
    expect(actor.getSnapshot().value).toBe('lossCut');

    actor.stop();
  });
});
