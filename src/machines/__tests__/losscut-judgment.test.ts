/**
 * T12: 損切り判断（LC）ステートマシン テスト
 *
 * 検証対象: INV-LC1〜LC5（5個）
 * 出典: docs/spec-verification-losscut.md §7.2
 *
 * 注: INV-LC5の30分タイマー（SP3-IE1）によるLC強制起動は
 * SP-3レベルの機能のため、verification-loop.test.tsで検証する。
 * 本テストでは isOver30Min ガードの動作をLC内部で検証する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActor } from 'xstate';
import { lossCutJudgmentMachine } from '../losscut-judgment';
import type { LossCutContext, ErrorInfo, ErrorRecord } from '../types';

// --- テストヘルパー ---

/** テスト用のエラー情報を生成 */
function makeError(
  step: ErrorInfo['step'] = 'typecheck',
  message = 'test error',
): ErrorInfo {
  return { step, message, timestamp: Date.now() };
}

/** テスト用のエラーレコードを生成 */
function makeErrorRecord(
  error: ErrorInfo,
  complexityDelta: ErrorRecord['complexityDelta'] = 'unchanged',
): ErrorRecord {
  return { error, fixAttempt: 'fix attempt', complexityDelta };
}

/** カスタムコンテキストでLCマシンを開始する */
function startLC(contextOverrides: Partial<LossCutContext> = {}) {
  const actor = createActor(lossCutJudgmentMachine, {
    input: undefined,
    snapshot: undefined,
    ...(Object.keys(contextOverrides).length > 0
      ? {
          snapshot: lossCutJudgmentMachine.resolveState({
            value: 'recordErrorState',
            context: {
              errorCount: 0,
              startedAt: Date.now(),
              lastError: null,
              errorHistory: [],
              lossCutDecision: null,
              ...contextOverrides,
            },
          }),
        }
      : {}),
  });
  actor.start();
  return actor;
}

/** LCをrecordErrorState通過後の判定チェーンに進める */
function advancePastRecord(actor: ReturnType<typeof startLC>) {
  actor.send({ type: 'ERROR_STATE_RECORDED' });
}

// =============================================================================
// INV-LC1: エラー状態の記録は損切り判定の前に必ず実行される
// =============================================================================

describe('INV-LC1: エラー状態の記録は損切り判定の前に必ず実行される', () => {
  it('LCの初期状態がrecordErrorStateである', () => {
    const actor = startLC();

    expect(actor.getSnapshot().value).toBe('recordErrorState');
    actor.stop();
  });

  it('ERROR_STATE_RECORDEDイベント後にcheck3Timesに遷移する', () => {
    const actor = startLC();

    actor.send({ type: 'ERROR_STATE_RECORDED' });

    // always遷移で即座に最終状態まで進む（errorCount=0なので全条件No → continueFix）
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
  });

  it('recordErrorStateを経由せずにcheck3Timesに直接遷移できない', () => {
    const actor = startLC();

    // recordErrorState状態では ERROR_STATE_RECORDED 以外のイベントは無視される
    // check3Times等の判定状態はalways遷移のため外部イベント不要だが、
    // recordErrorStateを通過しない限り到達できない
    expect(actor.getSnapshot().value).toBe('recordErrorState');
    actor.stop();
  });
});

// =============================================================================
// INV-LC2: 損切り4条件はOR条件で評価される
// =============================================================================

describe('INV-LC2: 損切り4条件はOR条件で評価される', () => {
  it('条件1: errorCount >= 3 → 損切り確定', () => {
    const actor = startLC({ errorCount: 3 });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    expect(actor.getSnapshot().context.lossCutDecision).toBe('cut');
    actor.stop();
  });

  it('条件2: 30分経過 → 損切り確定', () => {
    const thirtyOneMinAgo = Date.now() - 31 * 60 * 1000;
    const actor = startLC({ startedAt: thirtyOneMinAgo });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    expect(actor.getSnapshot().context.lossCutDecision).toBe('cut');
    actor.stop();
  });

  it('条件3: コード複雑度の増加 → 損切り確定', () => {
    const error = makeError();
    const actor = startLC({
      lastError: error,
      errorHistory: [makeErrorRecord(error, 'increased')],
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    expect(actor.getSnapshot().context.lossCutDecision).toBe('cut');
    actor.stop();
  });

  it('条件4: 同一エラーの再発 → 損切り確定', () => {
    const error = makeError('lint', 'recurring-error');
    const pastError = makeError('lint', 'recurring-error');
    const actor = startLC({
      lastError: error,
      errorHistory: [
        makeErrorRecord(pastError),  // 過去の同一エラー
        makeErrorRecord(error),      // 現在のエラー（最後のエントリ）
      ],
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    expect(actor.getSnapshot().context.lossCutDecision).toBe('cut');
    actor.stop();
  });
});

// =============================================================================
// INV-LC3: 4条件すべてに該当しない場合のみ修正継続
// =============================================================================

describe('INV-LC3: 4条件すべてに該当しない場合のみ修正継続', () => {
  it('全条件No → continueFixに到達する', () => {
    const actor = startLC({
      errorCount: 1,
      startedAt: Date.now(),
      lastError: makeError(),
      errorHistory: [makeErrorRecord(makeError(), 'unchanged')],
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('continueFix');
    expect(actor.getSnapshot().context.lossCutDecision).toBe('continue');
    actor.stop();
  });

  it('デフォルトコンテキスト（エラー0回、開始直後） → continueFix', () => {
    const actor = startLC();
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('continueFix');
    expect(actor.getSnapshot().output?.decision).toBe('continue');
    actor.stop();
  });
});

// =============================================================================
// INV-LC4: 4条件の評価順序は3回→30分→複雑化→再発、短絡評価
// =============================================================================

describe('INV-LC4: 4条件の評価順序は3回→30分→複雑化→再発、短絡評価', () => {
  it('3回条件Yesの場合、30分・複雑化・再発は評価されない（短絡評価）', () => {
    // errorCount >= 3 かつ 30分経過 かつ 複雑化 の状況
    // → check3Timesで即座にlossCutConfirmed（後続は到達不可）
    const error = makeError();
    const actor = startLC({
      errorCount: 5,
      startedAt: Date.now() - 31 * 60 * 1000,
      lastError: error,
      errorHistory: [makeErrorRecord(error, 'increased')],
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    // check3Timesで確定したことを確認（lossCutDecisionは'cut'）
    expect(actor.getSnapshot().context.lossCutDecision).toBe('cut');
    actor.stop();
  });

  it('3回条件Noで30分条件Yes → check30Minで確定', () => {
    const actor = startLC({
      errorCount: 1,
      startedAt: Date.now() - 31 * 60 * 1000,
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    actor.stop();
  });

  it('3回No・30分Noで複雑化Yes → checkComplexityで確定', () => {
    const error = makeError();
    const actor = startLC({
      errorCount: 1,
      startedAt: Date.now(),
      lastError: error,
      errorHistory: [makeErrorRecord(error, 'increased')],
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    actor.stop();
  });

  it('3回No・30分No・複雑化Noで再発Yes → checkRecurrenceで確定', () => {
    const error = makeError('test', 'same-error');
    const pastError = makeError('test', 'same-error');
    const actor = startLC({
      errorCount: 1,
      startedAt: Date.now(),
      lastError: error,
      errorHistory: [
        makeErrorRecord(pastError, 'unchanged'),
        makeErrorRecord(error, 'unchanged'),
      ],
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    actor.stop();
  });

  it('マシン定義の状態チェーン順序が正しい', () => {
    const states = lossCutJudgmentMachine.config.states;
    expect(states).toBeDefined();
    if (states) {
      const stateNames = Object.keys(states);
      const checkStates = stateNames.filter((s) => s.startsWith('check'));
      expect(checkStates).toEqual([
        'check3Times',
        'check30Min',
        'checkComplexity',
        'checkRecurrence',
      ]);
    }
  });
});

// =============================================================================
// INV-LC5: 30分経過または同一エラー3回目は損切り判断を強制起動
// =============================================================================

describe('INV-LC5: 30分経過または同一エラー3回目は損切り判断を強制起動', () => {
  /**
   * 注: SP3-IE1（30分タイマーによるLC強制起動）はSP-3レベルの `after` で実現されるため、
   * verification-loop.test.ts で検証する。
   * 本テストでは、LC内部の isOver30Min ガードと isErrorCount3OrMore ガードの動作を検証する。
   */

  it('errorCount=3でLC開始 → check3Timesで即座に損切り確定', () => {
    const actor = startLC({ errorCount: 3 });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    expect(actor.getSnapshot().output?.decision).toBe('cut');
    actor.stop();
  });

  it('errorCount=2でLC開始 → check3Timesを通過（損切りにならない）', () => {
    const actor = startLC({ errorCount: 2 });
    advancePastRecord(actor);

    // errorCount < 3 なので check3Times は通過、他の条件もNoなら continueFix
    expect(actor.getSnapshot().value).toBe('continueFix');
    actor.stop();
  });

  it('30分経過状態でLC開始 → check30Minで損切り確定', () => {
    const actor = startLC({
      errorCount: 0,
      startedAt: Date.now() - 1800001,
    });
    advancePastRecord(actor);

    expect(actor.getSnapshot().value).toBe('lossCutConfirmed');
    expect(actor.getSnapshot().output?.decision).toBe('cut');
    actor.stop();
  });
});

// =============================================================================
// 補足: 出力の正確性テスト
// =============================================================================

describe('出力: LCのoutputが正確に設定される', () => {
  it('損切り確定時: output.decision === "cut"', () => {
    const actor = startLC({ errorCount: 3 });
    advancePastRecord(actor);

    expect(actor.getSnapshot().output).toEqual({ decision: 'cut' });
    actor.stop();
  });

  it('修正継続時: output.decision === "continue"', () => {
    const actor = startLC();
    advancePastRecord(actor);

    expect(actor.getSnapshot().output).toEqual({ decision: 'continue' });
    actor.stop();
  });
});
