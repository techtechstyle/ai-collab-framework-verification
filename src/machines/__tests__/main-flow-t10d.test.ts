/**
 * T10d: INV-CA2対応テスト（DT-9 A4違反→DT-0復帰パス）
 *
 * 1文説明: SP-3でA4違反（principleViolation）が検出された場合に
 *          brightLinesCheckに戻ることを検証する
 *
 * 対応不変条件: INV-CA2
 * テスト方式: T10c学び — provide()による即doneモック置換
 *
 * 前提:
 *   - T10cの既存14件テストはmain-flow.test.tsに存在（そちらに追記でもOK）
 *   - このファイルはT10d分のINV-CA2テストのみを含む
 *   - ローカルでmain-flow.test.tsに統合する場合は、describe/itブロックをコピーする
 */

import { createMachine, createActor } from "xstate";
import { mainFlowMachine } from "../main-flow";

// ============================================
// テストヘルパー: provide()用モックマシン生成
// ============================================

/**
 * SP-1モック: 即allPassed（SP-1通過前提）
 */
function createSp1PassMock() {
  return createMachine({
    id: "sp1Mock",
    initial: "done",
    states: { done: { type: "final" } },
    output: { result: { l0: null, l1: null, l2: null, l3: null }, allPassed: true },
  });
}

/**
 * SP-2モック: 即humanLed（人間主導前提 — 最短パスでSP-3に到達）
 */
function createSp2HumanMock() {
  return createMachine({
    id: "sp2Mock",
    initial: "done",
    states: { done: { type: "final" } },
    output: { result: "humanLed", promptTechnique: null, taskCharacteristic: "unknown" },
  });
}

/**
 * SP-3モック: A4違反（principleViolation: true）を返す
 * INV-CA2テストのコア
 */
function createSp3PrincipleViolationMock() {
  return createMachine({
    id: "sp3Mock",
    initial: "done",
    states: { done: { type: "final" } },
    output: {
      passed: false,
      lossCut: false,
      lastError: null,
      errorHistory: [],
      principleViolation: true,  // ★ A4違反
    },
  });
}

/**
 * SP-3モック: 成功（principleViolation: false）
 * 既存パスとの区別確認用
 */
function createSp3PassMock() {
  return createMachine({
    id: "sp3Mock",
    initial: "done",
    states: { done: { type: "final" } },
    output: {
      passed: true,
      lossCut: false,
      lastError: null,
      errorHistory: [],
      principleViolation: false,
    },
  });
}

/**
 * SP-3モック: 損切り（lossCut: true, principleViolation: false）
 * lossCutパスとの区別確認用
 */
function createSp3LossCutMock() {
  return createMachine({
    id: "sp3Mock",
    initial: "done",
    states: { done: { type: "final" } },
    output: {
      passed: false,
      lossCut: true,
      lastError: { step: "test" as const, message: "test error", timestamp: 1 },
      errorHistory: [],
      principleViolation: false,
    },
  });
}

/**
 * RFモック: 即recovered（RFテスト用ダミー）
 */
function createRfMock() {
  return createMachine({
    id: "rfMock",
    initial: "done",
    states: { done: { type: "final" } },
    output: { recovered: true },
  });
}

// ============================================
// ヘルパー: MainFlowをBrightLines通過→SP-1→SP-2→SP-3まで進める
// ============================================

/**
 * MainFlowを人間主導パスでSP-3まで進めるための共通セットアップ
 * BrightLines通過 → SP-1(mock) → SP-2(mock) → humanExecution → SP-3(mock)
 */
function createMainFlowWithMocks(sp3Mock: ReturnType<typeof createMachine>) {
  const actor = createActor(
    mainFlowMachine.provide({
      actors: {
        sp1Machine: createSp1PassMock(),
        sp2Machine: createSp2HumanMock(),
        sp3Machine: sp3Mock,
        rfMachine: createRfMock(),
      },
    })
  );
  return actor;
}

/**
 * SP-3に到達するまでの共通イベントシーケンス（人間主導パス）
 */
function advanceToSp3(actor: ReturnType<typeof createActor>) {
  // brightLinesCheck → sp1Check (invoke, auto-done)
  actor.send({ type: "BRIGHT_LINES_PASS" });
  // sp1Check → sp2Division (invoke, auto-done)
  // sp2Division → humanExecution (auto-done, humanLed)
  // humanExecution → sp3Verification
  actor.send({ type: "EXECUTE_HUMAN", output: "test output" });
}

// ============================================
// T10d テスト
// ============================================

describe("T10d: INV-CA2 — DT-9 A4違反→DT-0復帰パス", () => {

  // ------------------------------------------
  // INV-CA2: A4違反 → brightLinesCheckに戻る
  // ------------------------------------------
  describe("INV-CA2: SP-3でA4違反検出時、brightLinesCheckに戻る", () => {

    it("SP-3がprincipleViolation=trueを返した場合、brightLinesCheck状態に遷移する", () => {
      const actor = createMainFlowWithMocks(createSp3PrincipleViolationMock());
      actor.start();

      advanceToSp3(actor);

      // SP-3のinvokeが完了し、principleViolation分岐が発火するのを待つ
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("brightLinesCheck");
      expect(snapshot.context.hasPrincipleViolation).toBe(true);
    });

    it("brightLinesCheck復帰後、BRIGHT_LINES_PASSで再度SP-1に進める", () => {
      const actor = createMainFlowWithMocks(createSp3PrincipleViolationMock());
      actor.start();

      advanceToSp3(actor);

      // brightLinesCheckに戻った状態
      expect(actor.getSnapshot().value).toBe("brightLinesCheck");

      // 再度Bright Lines通過 → SP-1へ（フロー継続可能を確認）
      actor.send({ type: "BRIGHT_LINES_PASS" });
      // SP-1 mockが即完了 → SP-2へ
      const snapshot = actor.getSnapshot();
      // SP-2 mockも即完了 → humanExecution到達
      expect(snapshot.value).toBe("humanExecution");
    });
  });

  // ------------------------------------------
  // 既存パスとの区別確認（リグレッション防止）
  // ------------------------------------------
  describe("既存パスとの分岐区別", () => {

    it("SP-3成功（passed=true）の場合、taskCompletedに遷移する（A4違反パスに入らない）", () => {
      const actor = createMainFlowWithMocks(createSp3PassMock());
      actor.start();

      advanceToSp3(actor);

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("taskCompleted");
      expect(snapshot.context.hasPrincipleViolation).toBe(false);
    });

    it("SP-3損切り（lossCut=true）の場合、recoveryFlowに遷移する（A4違反パスに入らない）", () => {
      const actor = createMainFlowWithMocks(createSp3LossCutMock());
      actor.start();

      advanceToSp3(actor);

      const snapshot = actor.getSnapshot();
      // RF mockが即完了 → recoveryExit
      expect(snapshot.value).toBe("recoveryExit");
      expect(snapshot.context.hasPrincipleViolation).toBe(false);
    });
  });

  // ------------------------------------------
  // context転写の確認
  // ------------------------------------------
  describe("context転写", () => {

    it("A4違反時、sp3ResultがcontextにprincipleViolation=trueで保持される", () => {
      const actor = createMainFlowWithMocks(createSp3PrincipleViolationMock());
      actor.start();

      advanceToSp3(actor);

      const ctx = actor.getSnapshot().context;
      expect(ctx.sp3Result).not.toBeNull();
      expect(ctx.sp3Result!.principleViolation).toBe(true);
      expect(ctx.sp3Result!.passed).toBe(false);
      expect(ctx.sp3Result!.lossCut).toBe(false);
    });
  });
});
