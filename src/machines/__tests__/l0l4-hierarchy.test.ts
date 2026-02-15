/**
 * T9: L0-L4 階層ステートマシン テスト
 *
 * 検証対象: INV-H1〜H5（5個）+ INV-SP1-1〜SP1-5（5個）= 計10個の不変条件
 * 出典: docs/spec-l0l4-hierarchy.md §6
 */

import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { l0l3CheckMachine } from '../l0l4-hierarchy';
import type { LevelResult } from '../types';

// --- テストヘルパー ---

/** 通過結果を生成 */
const passResult: LevelResult = { passed: true, issues: [] };

/** 不合格結果を生成（要対応項目あり） */
const failResult = (issues: string[] = ['テスト用の違反項目']): LevelResult => ({
  passed: false,
  issues,
});

/** マシンのアクターを生成して開始する */
function startMachine() {
  const actor = createActor(l0l3CheckMachine);
  actor.start();
  return actor;
}

// =============================================================================
// INV-SP1: L0-L3チェック不変条件群
// =============================================================================

describe('INV-SP1-1: L0チェックは常に最初に実行される', () => {
  it('マシン開始時の初期状態がl0Checkである', () => {
    const actor = startMachine();
    const snapshot = actor.getSnapshot();

    expect(snapshot.value).toBe('l0Check');

    actor.stop();
  });
});

describe('INV-SP1-2: 各レベルのチェックは直前のレベルを通過した後にのみ実行される', () => {
  it('L0通過 → L1に遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });

    expect(actor.getSnapshot().value).toBe('l1Check');
    actor.stop();
  });

  it('L0通過 → L1通過 → L2に遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });

    expect(actor.getSnapshot().value).toBe('l2Check');
    actor.stop();
  });

  it('L0通過 → L1通過 → L2通過 → L3に遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });

    expect(actor.getSnapshot().value).toBe('l3Check');
    actor.stop();
  });

  it('L0通過 → L1通過 → L2通過 → L3通過 → passedに遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L3_EVALUATION_COMPLETE', result: passResult });

    expect(actor.getSnapshot().value).toBe('passed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });
});

describe('INV-SP1-3: いずれかのレベルでNoの場合、failedに遷移し他レベルの評価はスキップされる', () => {
  it('L0不合格 → 即座にfailedに遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: failResult() });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  it('L1不合格 → failedに遷移する（L2, L3はスキップ）', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: failResult() });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  it('L2不合格 → failedに遷移する（L3はスキップ）', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: failResult() });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  it('L3不合格 → failedに遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L3_EVALUATION_COMPLETE', result: failResult() });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });
});

describe('INV-SP1-4: SP-1の結果は「全通過」または「不合格」の2つのみ', () => {
  it('全通過時: passed最終状態に到達する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L3_EVALUATION_COMPLETE', result: passResult });

    expect(actor.getSnapshot().value).toBe('passed');
    expect(actor.getSnapshot().output).toEqual({
      result: {
        l0: passResult,
        l1: passResult,
        l2: passResult,
        l3: passResult,
      },
      allPassed: true,
    });
    actor.stop();
  });

  it('不合格時: failed最終状態に到達する', () => {
    const actor = startMachine();
    const fail = failResult(['G1: 属人化を避ける仕組みがない']);

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: fail });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().output).toEqual({
      result: {
        l0: fail,
        l1: null,
        l2: null,
        l3: null,
      },
      allPassed: false,
    });
    actor.stop();
  });

  it('マシン定義に最終状態はpassedとfailedの2つのみ存在する', () => {
    // マシン定義の状態を直接検証
    const states = l0l3CheckMachine.config.states;
    expect(states).toBeDefined();
    if (states) {
      const finalStates = Object.entries(states).filter(
        ([, config]) => (config as { type?: string }).type === 'final'
      );
      expect(finalStates.map(([name]) => name).sort()).toEqual(['failed', 'passed']);
      expect(finalStates).toHaveLength(2);
    }
  });
});

describe('INV-SP1-5: 各レベルの詳細判断で「要対応」が1つでもあれば不合格', () => {
  it('issues配列に1つの項目 → passed=falseでfailedに遷移する', () => {
    const actor = startMachine();
    const result = failResult(['G3: 技術的負債を増やす']);

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().context.evaluationResults.l0).toEqual(result);
    actor.stop();
  });

  it('issues配列に複数の項目 → passed=falseでfailedに遷移する', () => {
    const actor = startMachine();
    const result = failResult([
      'G1: 属人化を避ける仕組みがない',
      'G3: 技術的負債を増やす',
      'R2: 回復手段が定義されていない',
    ]);

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result });

    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().context.evaluationResults.l0?.issues).toHaveLength(3);
    actor.stop();
  });

  it('issues配列が空 → passed=trueで次レベルに遷移する', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });

    // passed=trueなので次のl1Checkに遷移
    expect(actor.getSnapshot().value).toBe('l1Check');
    actor.stop();
  });
});

// =============================================================================
// INV-H: 階層不変条件群
// =============================================================================

describe('INV-H1: L0〜L4の評価順序は常にL0→L1→L2→L3→L4であり、逆転しない', () => {
  it('全通過パスでL0→L1→L2→L3の順序が保証される', () => {
    const actor = startMachine();
    const stateHistory: string[] = [];

    // 各遷移時の状態を記録
    stateHistory.push(String(actor.getSnapshot().value));

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    stateHistory.push(String(actor.getSnapshot().value));

    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    stateHistory.push(String(actor.getSnapshot().value));

    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    stateHistory.push(String(actor.getSnapshot().value));

    actor.send({ type: 'L3_EVALUATION_COMPLETE', result: passResult });
    stateHistory.push(String(actor.getSnapshot().value));

    expect(stateHistory).toEqual([
      'l0Check',
      'l1Check',
      'l2Check',
      'l3Check',
      'passed',
    ]);
    actor.stop();
  });

  it('l1Check状態でL0のイベントを送信しても状態が変わらない（逆方向遷移不可）', () => {
    const actor = startMachine();

    // L0通過 → l1Check
    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    expect(actor.getSnapshot().value).toBe('l1Check');

    // l1Check状態でL0イベントを送信 → 無視される
    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    expect(actor.getSnapshot().value).toBe('l1Check');

    actor.stop();
  });
});

describe('INV-H2: 上位レベルでNoとなった場合、下位レベルの評価は行われない', () => {
  it('L0不合格時、L1〜L3の評価結果がnullのまま（未評価）', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: failResult() });

    const ctx = actor.getSnapshot().context;
    expect(ctx.evaluationResults.l0?.passed).toBe(false);
    expect(ctx.evaluationResults.l1).toBeNull();
    expect(ctx.evaluationResults.l2).toBeNull();
    expect(ctx.evaluationResults.l3).toBeNull();
    actor.stop();
  });

  it('L1不合格時、L2〜L3の評価結果がnullのまま（未評価）', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: failResult() });

    const ctx = actor.getSnapshot().context;
    expect(ctx.evaluationResults.l0?.passed).toBe(true);
    expect(ctx.evaluationResults.l1?.passed).toBe(false);
    expect(ctx.evaluationResults.l2).toBeNull();
    expect(ctx.evaluationResults.l3).toBeNull();
    actor.stop();
  });

  it('failed状態でイベントを送信しても受け付けない', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: failResult() });
    expect(actor.getSnapshot().value).toBe('failed');

    // failed（最終状態）では追加のイベントは処理されない
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    expect(actor.getSnapshot().context.evaluationResults.l1).toBeNull();
    actor.stop();
  });
});

describe('INV-H3: L4は常にL0〜L3のすべてを通過した後にのみ適用される', () => {
  it('全通過時のoutputでallPassed=trueが返る（SP-2への遷移条件）', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L3_EVALUATION_COMPLETE', result: passResult });

    expect(actor.getSnapshot().output?.allPassed).toBe(true);
    actor.stop();
  });

  it('一部不合格時のoutputでallPassed=falseが返る（SP-2への遷移を阻止）', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: failResult() });

    expect(actor.getSnapshot().output?.allPassed).toBe(false);
    actor.stop();
  });

  it('passed最終状態に到達するには4レベル全通過が必要', () => {
    // L3まで全通過 → passed
    const actor1 = startMachine();
    actor1.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor1.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor1.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    actor1.send({ type: 'L3_EVALUATION_COMPLETE', result: passResult });
    expect(actor1.getSnapshot().value).toBe('passed');
    actor1.stop();

    // L2で不合格 → passed到達不可
    const actor2 = startMachine();
    actor2.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor2.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor2.send({ type: 'L2_EVALUATION_COMPLETE', result: failResult() });
    expect(actor2.getSnapshot().value).not.toBe('passed');
    actor2.stop();
  });
});

describe('INV-H4: 競合発生時、上位レベルの判断が常に優先される', () => {
  it('L0不合格 → L1以降は評価されず、L0の判断が最終結果を決定する', () => {
    const actor = startMachine();

    actor.send({
      type: 'L0_EVALUATION_COMPLETE',
      result: failResult(['G1: 属人化リスク']),
    });

    // L0の判断で即座にfailed → 下位レベルは評価機会なし
    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().output?.allPassed).toBe(false);
    expect(actor.getSnapshot().context.evaluationResults.l0?.issues).toContain(
      'G1: 属人化リスク'
    );
    actor.stop();
  });

  it('逐次評価により上位レベルのNoが下位レベルに先行する', () => {
    // L1不合格のケース: L0は通過したがL1が拒否 → L2, L3は評価されない
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({
      type: 'L1_EVALUATION_COMPLETE',
      result: failResult(['P1: 心理的安全性の欠如']),
    });

    expect(actor.getSnapshot().value).toBe('failed');
    // L1の判断が最終結果を決定
    expect(actor.getSnapshot().context.evaluationResults.l1?.issues).toContain(
      'P1: 心理的安全性の欠如'
    );
    // L2以降は未評価
    expect(actor.getSnapshot().context.evaluationResults.l2).toBeNull();
    actor.stop();
  });
});

describe('INV-H5: Bright Linesは全レベルに先行する', () => {
  /**
   * INV-H5の構造的保証はT6（メインフロー）で実現される。
   * T9のスコープでは以下を確認:
   * - SP-1マシン自体はBright Linesチェックを含まない（前提条件として委譲）
   * - SP-1はl0Checkから開始する（Bright Lines通過後に呼び出される想定）
   */
  it('SP-1マシンの初期状態はl0Checkであり、Bright Linesチェック状態を含まない', () => {
    const actor = startMachine();

    // 初期状態はl0Check（Bright Linesチェック状態ではない）
    expect(actor.getSnapshot().value).toBe('l0Check');
    actor.stop();
  });

  it('SP-1マシンの状態にbrightLinesCheckは存在しない（T6で外部定義）', () => {
    const states = l0l3CheckMachine.config.states;
    expect(states).toBeDefined();
    if (states) {
      expect(Object.keys(states)).not.toContain('brightLinesCheck');
    }
  });
});

// =============================================================================
// 補足: コンテキストの正確性テスト
// =============================================================================

describe('コンテキスト: 評価結果が正確に記録される', () => {
  it('全通過パスで全レベルの評価結果がcontextに保存される', () => {
    const actor = startMachine();

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L3_EVALUATION_COMPLETE', result: passResult });

    const ctx = actor.getSnapshot().context;
    expect(ctx.evaluationResults.l0).toEqual(passResult);
    expect(ctx.evaluationResults.l1).toEqual(passResult);
    expect(ctx.evaluationResults.l2).toEqual(passResult);
    expect(ctx.evaluationResults.l3).toEqual(passResult);
    actor.stop();
  });

  it('途中不合格でも評価済みレベルの結果は保存される', () => {
    const actor = startMachine();
    const l2Fail = failResult(['H2: 検証手順が不十分']);

    actor.send({ type: 'L0_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L1_EVALUATION_COMPLETE', result: passResult });
    actor.send({ type: 'L2_EVALUATION_COMPLETE', result: l2Fail });

    const ctx = actor.getSnapshot().context;
    expect(ctx.evaluationResults.l0).toEqual(passResult);
    expect(ctx.evaluationResults.l1).toEqual(passResult);
    expect(ctx.evaluationResults.l2).toEqual(l2Fail);
    expect(ctx.evaluationResults.l3).toBeNull(); // 未評価
    actor.stop();
  });
});
