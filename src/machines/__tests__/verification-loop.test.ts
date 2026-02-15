/**
 * T11: 検証ループ（SP-3）ステートマシン テスト
 *
 * 検証対象: INV-SP3-1〜SP3-5（5個）
 * 出典: docs/spec-verification-losscut.md §7.1
 *
 * 追加検証: INV-LC5の30分タイマー（SP3-IE1）はSP-3レベルの機能のためここで検証
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActor } from "xstate";
import { verificationLoopMachine } from "../verification-loop";
import type { CheckResult, ErrorInfo, VerificationLoopContext } from "../types";
import type { SP3OutputExtended } from "../types";

// --- テストヘルパー ---

/** 検証成功の結果 */
const passResult: CheckResult = { passed: true };

/** 検証失敗の結果を生成 */
function failResult(
  step: ErrorInfo["step"] = "typecheck",
  message = "test error",
): CheckResult {
  return {
    passed: false,
    error: { step, message, timestamp: Date.now() },
  };
}

/** マシンを開始する */
function startMachine() {
  const actor = createActor(verificationLoopMachine);
  actor.start();
  return actor;
}

// =============================================================================
// INV-SP3-1: 検証の実行順序はtypecheck→lint→testであり、変更できない
// =============================================================================

describe("INV-SP3-1: 検証の実行順序はtypecheck→lint→testであり、変更できない", () => {
  it("初期状態がtypecheckである", () => {
    const actor = startMachine();

    expect(actor.getSnapshot().value).toBe("typecheck");
    actor.stop();
  });

  it("全通過パスでtypecheck→lint→testの順序が保証される", () => {
    const actor = startMachine();
    const history: (string | object)[] = [];

    history.push(actor.getSnapshot().value);

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    history.push(actor.getSnapshot().value);

    actor.send({ type: "LINT_COMPLETE", result: passResult });
    history.push(actor.getSnapshot().value);

    actor.send({ type: "TEST_COMPLETE", result: passResult });
    history.push(actor.getSnapshot().value);

    expect(history).toEqual([
      "typecheck",
      "lint",
      "test",
      "verificationPassed",
    ]);
    actor.stop();
  });

  it("typecheck状態でLINT_COMPLETEを送信しても遷移しない", () => {
    const actor = startMachine();

    actor.send({ type: "LINT_COMPLETE", result: passResult });

    expect(actor.getSnapshot().value).toBe("typecheck");
    actor.stop();
  });

  it("修正後のループでもtypecheckから再開する", () => {
    const actor = startMachine();

    // typecheck失敗 → LC → continueFix → issueFix → typecheck
    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    // LC内: recordErrorState → check3Times → ... → continueFix → issueFix
    actor.send({ type: "ERROR_STATE_RECORDED" });
    // LC完了 → issueFix
    expect(actor.getSnapshot().value).toBe("issueFix");

    actor.send({ type: "FIX_ISSUED" });

    // typecheckに戻る
    expect(actor.getSnapshot().value).toBe("typecheck");
    actor.stop();
  });
});

// =============================================================================
// INV-SP3-2: 前段の検証が成功しない限り、次段の検証には進めない
// =============================================================================

describe("INV-SP3-2: 前段の検証が成功しない限り、次段の検証には進めない", () => {
  it("typecheck成功 → lintに進む", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });

    expect(actor.getSnapshot().value).toBe("lint");
    actor.stop();
  });

  it("typecheck失敗 → lintに進めずlossCutJudgmentに遷移", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });

    // lossCutJudgment内のrecordErrorState
    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });

  it("lint成功 → testに進む", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: passResult });

    expect(actor.getSnapshot().value).toBe("test");
    actor.stop();
  });

  it("lint失敗 → testに進めずlossCutJudgmentに遷移", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: failResult("lint") });

    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });
});

// =============================================================================
// INV-SP3-3: 協働原則チェックとAI行動原則チェックは検証プロセスと並行して常に監視
// =============================================================================

describe("INV-SP3-3: 協働原則チェックとAI行動原則チェックは検証プロセスと並行して常に監視される", () => {
  /**
   * 設計判断#2（entry/exitアクション方式）により、
   * 各検証状態のentryアクションに原則チェックが含まれていることを構造的に検証する
   */

  it("typecheck状態のentryに原則チェックアクションが含まれる", () => {
    const states = verificationLoopMachine.config.states;
    const typecheckEntry = (states as Record<string, { entry?: unknown[] }>)
      ?.typecheck?.entry;

    expect(typecheckEntry).toBeDefined();
    expect(typecheckEntry).toContainEqual({
      type: "checkCollaborationPrinciples",
    });
    expect(typecheckEntry).toContainEqual({ type: "checkAIPrinciples" });
  });

  it("lint状態のentryに原則チェックアクションが含まれる", () => {
    const states = verificationLoopMachine.config.states;
    const lintEntry = (states as Record<string, { entry?: unknown[] }>)?.lint
      ?.entry;

    expect(lintEntry).toBeDefined();
    expect(lintEntry).toContainEqual({ type: "checkCollaborationPrinciples" });
    expect(lintEntry).toContainEqual({ type: "checkAIPrinciples" });
  });

  it("test状態のentryに原則チェックアクションが含まれる", () => {
    const states = verificationLoopMachine.config.states;
    const testEntry = (states as Record<string, { entry?: unknown[] }>)?.test
      ?.entry;

    expect(testEntry).toBeDefined();
    expect(testEntry).toContainEqual({ type: "checkCollaborationPrinciples" });
    expect(testEntry).toContainEqual({ type: "checkAIPrinciples" });
  });

  it("修正ループ時もtypecheckから再開し、原則チェックが再実行される（構造的保証）", () => {
    // issueFix → typecheck のループで typecheck の entry が再実行されることを確認
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    actor.send({ type: "ERROR_STATE_RECORDED" });
    // LC → continueFix → issueFix
    actor.send({ type: "FIX_ISSUED" });

    // typecheck に戻った = entry アクション（原則チェック含む）が再実行される
    expect(actor.getSnapshot().value).toBe("typecheck");
    actor.stop();
  });
});

// =============================================================================
// INV-SP3-4: いずれかの検証が失敗した場合、損切り判断（LC）が起動される
// =============================================================================

describe("INV-SP3-4: いずれかの検証が失敗した場合、損切り判断（LC）が起動される", () => {
  it("typecheck失敗 → LCが起動される", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult("typecheck") });

    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });

  it("lint失敗 → LCが起動される", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: failResult("lint") });

    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });

  it("test失敗 → LCが起動される", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: passResult });
    actor.send({ type: "TEST_COMPLETE", result: failResult("test") });

    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });

  it("失敗時にerrorCountが増加する", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });

    expect(actor.getSnapshot().context.errorCount).toBe(1);
    actor.stop();
  });

  it("失敗時にerrorHistoryにエラーが記録される", () => {
    const actor = startMachine();
    const error = failResult("typecheck", "type error: missing property");

    actor.send({ type: "TYPECHECK_COMPLETE", result: error });

    const history = actor.getSnapshot().context.errorHistory;
    expect(history).toHaveLength(1);
    expect(history[0].error.message).toBe("type error: missing property");
    actor.stop();
  });
});

// =============================================================================
// INV-SP3-5: SP-3の正常終了は全3段階の検証がすべて成功した場合のみ
// =============================================================================

describe("INV-SP3-5: SP-3の正常終了は全3段階の検証がすべて成功した場合のみ", () => {
  it("typecheck→lint→test全通過 → verificationPassedに到達", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: passResult });
    actor.send({ type: "TEST_COMPLETE", result: passResult });

    expect(actor.getSnapshot().value).toBe("verificationPassed");
    expect(actor.getSnapshot().status).toBe("done");
    actor.stop();
  });

  it("全通過時のoutputが正しい", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: passResult });
    actor.send({ type: "TEST_COMPLETE", result: passResult });

    expect(actor.getSnapshot().output).toMatchObject({
      passed: true,
      lossCut: false,
    });
    actor.stop();
  });

  it("verificationPassedへの遷移元はtest状態のみ", () => {
    const states = verificationLoopMachine.config.states;
    expect(states).toBeDefined();
    if (states) {
      // verificationPassed をターゲットに持つのは test 状態のみ
      const statesWithPassedTarget = Object.entries(states).filter(
        ([name, config]) => {
          const stateConfig = config as { on?: Record<string, unknown> };
          const serialized = JSON.stringify(stateConfig.on ?? {});
          return (
            serialized.includes("verificationPassed") &&
            name !== "verificationPassed"
          );
        },
      );
      expect(statesWithPassedTarget.map(([name]) => name)).toEqual(["test"]);
    }
  });
});

// =============================================================================
// 30分タイマーテスト（INV-LC5: SP-3レベル）
// =============================================================================

describe("INV-LC5 (SP-3レベル): 30分タイマーによるLC強制起動", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("30分経過でtypecheck状態からlossCutJudgmentに強制遷移する", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().value).toBe("typecheck");

    // 30分経過
    vi.advanceTimersByTime(1800000);

    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });

  it("30分経過でlint状態からlossCutJudgmentに強制遷移する", () => {
    const actor = startMachine();

    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    expect(actor.getSnapshot().value).toBe("lint");

    // 30分経過
    vi.advanceTimersByTime(1800000);

    const value = actor.getSnapshot().value;
    expect(value).toHaveProperty("lossCutJudgment");
    actor.stop();
  });

  it("29分59秒ではタイマーが発火しない", () => {
    const actor = startMachine();

    vi.advanceTimersByTime(1799999);

    expect(actor.getSnapshot().value).toBe("typecheck");
    actor.stop();
  });
});

// =============================================================================
// 補足: SP-3のループ動作テスト
// =============================================================================

describe("ループ動作: LC修正継続 → issueFix → typecheck再開", () => {
  it("検証失敗 → LC（continue）→ issueFix → typecheckに戻る", () => {
    const actor = startMachine();

    // typecheck失敗
    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    // LC: recordErrorState → check3Times → ... → continueFix
    actor.send({ type: "ERROR_STATE_RECORDED" });
    // LC完了（continue）→ issueFix
    expect(actor.getSnapshot().value).toBe("issueFix");

    // 修正完了 → typecheckに戻る
    actor.send({ type: "FIX_ISSUED" });
    expect(actor.getSnapshot().value).toBe("typecheck");
    actor.stop();
  });

  it("修正後に全通過すればverificationPassedに到達する", () => {
    const actor = startMachine();

    // 1回目: typecheck失敗
    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    actor.send({ type: "ERROR_STATE_RECORDED" });
    actor.send({ type: "FIX_ISSUED" });

    // 2回目: 全通過
    actor.send({ type: "TYPECHECK_COMPLETE", result: passResult });
    actor.send({ type: "LINT_COMPLETE", result: passResult });
    actor.send({ type: "TEST_COMPLETE", result: passResult });

    expect(actor.getSnapshot().value).toBe("verificationPassed");
    expect(actor.getSnapshot().output).toMatchObject({
      passed: true,
      lossCut: false,
    });
    actor.stop();
  });

  it("3回目の失敗でLC内のcheck3Timesが損切り確定する", () => {
    const actor = startMachine();

    // 1回目失敗
    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    actor.send({ type: "ERROR_STATE_RECORDED" });
    actor.send({ type: "FIX_ISSUED" });

    // 2回目失敗
    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    actor.send({ type: "ERROR_STATE_RECORDED" });
    actor.send({ type: "FIX_ISSUED" });

    // 3回目失敗 → errorCount=3 → LC内でcheck3Timesが即座に損切り確定
    actor.send({ type: "TYPECHECK_COMPLETE", result: failResult() });
    actor.send({ type: "ERROR_STATE_RECORDED" });

    // LC → lossCutConfirmed → verificationFailed
    expect(actor.getSnapshot().value).toBe("verificationFailed");
    expect(actor.getSnapshot().status).toBe("done");
    expect(actor.getSnapshot().output).toMatchObject({
      passed: false,
      lossCut: true,
    });
    actor.stop();
  });
  describe("SP3OutputExtended: 拡張出力にlastError/errorHistoryが含まれる", () => {
    it("正常終了時: lastError=null, errorHistory=空配列", () => {
      const actor = createActor(verificationLoopMachine);
      actor.start();

      // 全検証を成功させる
      actor.send({ type: "TYPECHECK_COMPLETE", result: { passed: true } });
      actor.send({ type: "LINT_COMPLETE", result: { passed: true } });
      actor.send({ type: "TEST_COMPLETE", result: { passed: true } });

      const snapshot = actor.getSnapshot();
      expect(snapshot.status).toBe("done");
      expect(snapshot.output).toMatchObject({
        passed: true,
        lossCut: false,
        lastError: null,
        errorHistory: [],
      });
    });

    it("損切り終了時: lastErrorとerrorHistoryが引き渡される", () => {
      const actor = createActor(verificationLoopMachine);
      actor.start();

      const testError = {
        step: "typecheck" as const,
        message: "type error",
        timestamp: Date.now(),
      };

      // 3回失敗させて損切り確定
      for (let i = 0; i < 3; i++) {
        actor.send({
          type: "TYPECHECK_COMPLETE",
          result: { passed: false, error: testError },
        });
        actor.send({ type: "ERROR_STATE_RECORDED" });
        if (i < 2) {
          actor.send({ type: "FIX_ISSUED" });
        }
      }

      const snapshot = actor.getSnapshot();
      expect(snapshot.status).toBe("done");

      const output = snapshot.output as SP3OutputExtended;
      expect(output.passed).toBe(false);
      expect(output.lossCut).toBe(true);
      // 拡張フィールドの検証
      expect(output.lastError).not.toBeNull();
      expect(output.lastError?.step).toBe("typecheck");
      expect(output.errorHistory.length).toBeGreaterThan(0);
    });
  });
});
