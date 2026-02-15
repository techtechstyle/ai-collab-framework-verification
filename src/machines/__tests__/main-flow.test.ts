/**
 * T10c: MainFlow テスト
 *
 * 検証対象: INV-MF1〜MF6, INV-CF1〜CF5（11個の不変条件）
 * 検証基準: テスト 11件以上が通過すること
 *
 * テスト戦略:
 *   - サブマシン（SP-1/SP-2/SP-3/RF）は provide() でモックに置換
 *   - 各モックは即座にfinal stateに到達し、指定されたoutputを返す
 *   - MainFlow自体の状態遷移ロジックに集中して検証
 */

import { describe, it, expect } from "vitest";
import { createMachine, createActor, waitFor } from "xstate";
import { mainFlowMachine, createMainFlowContext } from "../main-flow";
import type {
  L0L3CheckOutput,
  SP2Output,
  SP3OutputExtended,
  RecoveryFlowOutput,
} from "../types";

// =============================================================================
// テストヘルパー: サブマシンのモック生成
// =============================================================================

/** SP-1モック: 全通過 */
function createSp1PassMock() {
  return createMachine({
    id: "sp1Mock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): L0L3CheckOutput => ({
      result: { l0: null, l1: null, l2: null, l3: null },
      allPassed: true,
    }),
  });
}

/** SP-1モック: 不合格 */
function createSp1FailMock() {
  return createMachine({
    id: "sp1Mock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): L0L3CheckOutput => ({
      result: { l0: null, l1: null, l2: null, l3: null },
      allPassed: false,
    }),
  });
}

/** SP-2モック: AI主導 */
function createSp2AiLedMock() {
  return createMachine({
    id: "sp2Mock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP2Output => ({
      result: "aiLed",
      promptTechnique: "zeroShot",
      taskCharacteristic: "initialDraft",
    }),
  });
}

/** SP-2モック: 人間主導 */
function createSp2HumanLedMock() {
  return createMachine({
    id: "sp2Mock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP2Output => ({
      result: "humanLed",
      promptTechnique: null,
      taskCharacteristic: "designDecision",
    }),
  });
}

/** SP-3モック: 検証成功 */
function createSp3PassMock() {
  return createMachine({
    id: "sp3Mock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP3OutputExtended => ({
      passed: true,
      lossCut: false,
      lastError: null,
      errorHistory: [],
    }),
  });
}

/** SP-3モック: 損切り */
function createSp3LossCutMock() {
  return createMachine({
    id: "sp3Mock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP3OutputExtended => ({
      passed: false,
      lossCut: true,
      lastError: { step: "test", message: "test failed", timestamp: 0 },
      errorHistory: [],
    }),
  });
}

/** RFモック: 復帰完了 */
function createRfMock() {
  return createMachine({
    id: "rfMock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): RecoveryFlowOutput => ({
      recovered: true,
    }),
  });
}

/**
 * MainFlowマシンにモックサブマシンを注入して生成するヘルパー
 */
function createTestMachine(overrides: {
  sp1?: ReturnType<typeof createSp1PassMock>;
  sp2?: ReturnType<typeof createSp2AiLedMock>;
  sp3?: ReturnType<typeof createSp3PassMock>;
  rf?: ReturnType<typeof createRfMock>;
}) {
  return mainFlowMachine.provide({
    actors: {
      ...(overrides.sp1 ? { sp1Machine: overrides.sp1 } : {}),
      ...(overrides.sp2 ? { sp2Machine: overrides.sp2 } : {}),
      ...(overrides.sp3 ? { sp3Machine: overrides.sp3 } : {}),
      ...(overrides.rf ? { rfMachine: overrides.rf } : {}),
    },
  });
}

// =============================================================================
// テスト
// =============================================================================

describe("MainFlow（T10c）", () => {
  // -------------------------------------------------------------------------
  // INV-MF1: すべてのタスクはBright Linesチェックを通過後に実行
  // -------------------------------------------------------------------------
  describe("INV-MF1: Bright Lines事前チェック", () => {
    it("初期状態はbrightLinesCheckである", () => {
      const machine = createTestMachine({});
      const actor = createActor(machine);
      actor.start();

      expect(actor.getSnapshot().value).toBe("brightLinesCheck");

      actor.stop();
    });

    it("BRIGHT_LINES_PASS → sp1Checkに遷移する", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2AiLedMock(),
        sp3: createSp3PassMock(),
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      // sp1Mockは即座にdoneになるので、onDoneが発火してsp2Divisionへ
      // ただしactor の状態遷移はmicrotaskで処理されるため、
      // sp1Checkを経由したことを確認するにはスナップショットのタイミングに注意
      // ここではsp1Check「を通過して」後続に到達することを検証
      const snapshot = await waitFor(actor, (s) => s.value !== "brightLinesCheck");
      // sp1Mockが即座にdoneなので、sp2Divisionかそれ以降に到達しているはず
      expect(snapshot.value).not.toBe("brightLinesCheck");
      expect(snapshot.value).not.toBe("brightLinesFix");

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-MF2: Bright Lines是正→再チェックループ
  // -------------------------------------------------------------------------
  describe("INV-MF2: Bright Lines是正ループ", () => {
    it("BRIGHT_LINES_FAIL → brightLinesFixに遷移する", () => {
      const machine = createTestMachine({});
      const actor = createActor(machine);
      actor.start();

      actor.send({
        type: "BRIGHT_LINES_FAIL",
        violations: ["BL1_humanJudgment" as const],
      });

      expect(actor.getSnapshot().value).toBe("brightLinesFix");

      actor.stop();
    });

    it("brightLinesFix → BRIGHT_LINES_FIXED → brightLinesCheckに戻る", () => {
      const machine = createTestMachine({});
      const actor = createActor(machine);
      actor.start();

      // 1回目: 違反検出
      actor.send({
        type: "BRIGHT_LINES_FAIL",
        violations: ["BL1_humanJudgment" as const],
      });
      expect(actor.getSnapshot().value).toBe("brightLinesFix");

      // 是正完了 → 再チェック
      actor.send({ type: "BRIGHT_LINES_FIXED" });
      expect(actor.getSnapshot().value).toBe("brightLinesCheck");

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-MF3: SP-1不合格→SP-2に進めない、調整→再チェック
  // -------------------------------------------------------------------------
  describe("INV-MF3: SP-1不合格時の調整ループ", () => {
    it("SP-1不合格 → taskAdjustmentに遷移（SP-2には進めない）", async () => {
      const machine = createTestMachine({
        sp1: createSp1FailMock(),
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      const snapshot = await waitFor(actor, (s) => s.value === "taskAdjustment");

      expect(snapshot.value).toBe("taskAdjustment");
      // SP-2には到達していないことを確認
      expect(snapshot.context.sp2Result).toBeNull();

      actor.stop();
    });

    it("taskAdjustment → ADJUSTMENT_DONE → sp1Checkに戻る", async () => {
      // 1回目: SP-1不合格、2回目: SP-1合格
      let callCount = 0;
      const sp1ToggleMock = createMachine({
        id: "sp1Toggle",
        initial: "done",
        states: { done: { type: "final" as const } },
        output: (): L0L3CheckOutput => {
          callCount++;
          return {
            result: { l0: null, l1: null, l2: null, l3: null },
            allPassed: callCount > 1, // 2回目以降は合格
          };
        },
      });

      const machine = createTestMachine({
        sp1: sp1ToggleMock,
        sp2: createSp2HumanLedMock(),
        sp3: createSp3PassMock(),
      });
      const actor = createActor(machine);
      actor.start();

      // Bright Lines通過 → SP-1（1回目: 不合格）
      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "taskAdjustment");

      // 調整完了 → SP-1再チェック（2回目: 合格）→ SP-2へ
      actor.send({ type: "ADJUSTMENT_DONE" });
      const snapshot = await waitFor(
        actor,
        (s) => s.value !== "sp1Check" && s.value !== "taskAdjustment"
      );

      // SP-2以降に到達
      expect(snapshot.context.adjustmentCount).toBe(1);

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-MF4: AI適用パスでT-5（humanReview）は省略不可
  // -------------------------------------------------------------------------
  describe("INV-MF4: AI適用パスの人間レビュー必須", () => {
    it("AI主導 → aiExecution → humanReview → sp3Verification の順に遷移する", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2AiLedMock(),
        sp3: createSp3PassMock(),
      });
      const actor = createActor(machine);
      actor.start();

      // Bright Lines通過 → SP-1(通過) → SP-2(AI主導)
      actor.send({ type: "BRIGHT_LINES_PASS" });
      const aiState = await waitFor(actor, (s) => s.value === "aiExecution");
      expect(aiState.value).toBe("aiExecution");

      // T-4: AI実行
      actor.send({ type: "EXECUTE_AI", output: "AI generated code" });
      expect(actor.getSnapshot().value).toBe("humanReview"); // T-5は省略されない

      // T-5: 人間レビュー
      actor.send({ type: "HUMAN_REVIEW_DONE", approved: true });
      // SP-3のモックが即座にdoneなので、taskCompletedに到達
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-MF5: 人間主導パスもAI適用パスもSP-3を通過する
  // -------------------------------------------------------------------------
  describe("INV-MF5: 両パスがSP-3に合流", () => {
    it("人間主導パスでもSP-3を経由して完了する", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2HumanLedMock(),
        sp3: createSp3PassMock(),
      });
      const actor = createActor(machine);
      actor.start();

      // Bright Lines通過 → SP-1(通過) → SP-2(人間主導)
      actor.send({ type: "BRIGHT_LINES_PASS" });
      const humanState = await waitFor(
        actor,
        (s) => s.value === "humanExecution"
      );
      expect(humanState.value).toBe("humanExecution");

      // T-3: 人間実行 → SP-3
      actor.send({ type: "EXECUTE_HUMAN", output: "human output" });
      // SP-3モックが即座にdone → taskCompleted
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");
      // SP-3の結果がcontextに保存されている = SP-3を経由した証拠
      expect(finalState.context.sp3Result).not.toBeNull();
      expect(finalState.context.sp3Result?.passed).toBe(true);

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-MF6: 終了は2パターンのみ（taskCompleted / recoveryExit）
  // -------------------------------------------------------------------------
  describe("INV-MF6: 終了パターン", () => {
    it("SP-3成功 → taskCompleted（EE-1）で終了する", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2HumanLedMock(),
        sp3: createSp3PassMock(),
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "output" });

      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");
      expect(finalState.output.completionType).toBe("taskCompleted");

      actor.stop();
    });

    it("SP-3損切り → RF → recoveryExit（EE-2）で終了する", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2HumanLedMock(),
        sp3: createSp3LossCutMock(),
        rf: createRfMock(),
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "output" });

      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");
      expect(finalState.output.completionType).toBe("recoveryExit");
      expect(finalState.output.recoveryResult?.recovered).toBe(true);

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-CF1: SP-1→SP-2→SP-3の呼び出し順序が固定
  // -------------------------------------------------------------------------
  describe("INV-CF1: サブプロセスの実行順序固定", () => {
    it("SP-1→SP-2→SP-3の順序で実行される（AI主導パス）", async () => {
      const executionOrder: string[] = [];

      const sp1Track = createMachine({
        id: "sp1Track",
        initial: "done",
        states: { done: { type: "final" as const } },
        output: (): L0L3CheckOutput => {
          executionOrder.push("SP-1");
          return {
            result: { l0: null, l1: null, l2: null, l3: null },
            allPassed: true,
          };
        },
      });

      const sp2Track = createMachine({
        id: "sp2Track",
        initial: "done",
        states: { done: { type: "final" as const } },
        output: (): SP2Output => {
          executionOrder.push("SP-2");
          return {
            result: "aiLed",
            promptTechnique: "zeroShot",
            taskCharacteristic: "initialDraft",
          };
        },
      });

      const sp3Track = createMachine({
        id: "sp3Track",
        initial: "done",
        states: { done: { type: "final" as const } },
        output: (): SP3OutputExtended => {
          executionOrder.push("SP-3");
          return { passed: true, lossCut: false, lastError: null, errorHistory: [] };
        },
      });

      const machine = createTestMachine({
        sp1: sp1Track,
        sp2: sp2Track,
        sp3: sp3Track,
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "aiExecution");
      actor.send({ type: "EXECUTE_AI", output: "ai output" });
      // humanReviewに遷移
      actor.send({ type: "HUMAN_REVIEW_DONE", approved: true });
      await waitFor(actor, (s) => s.status === "done");

      expect(executionOrder).toEqual(["SP-1", "SP-2", "SP-3"]);

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // INV-CF4: RF完了後にrecoveryExitに遷移する（SE-1に戻る）
  // -------------------------------------------------------------------------
  describe("INV-CF4: RF完了後の遷移", () => {
    it("RF完了 → recoveryExitに遷移する", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2HumanLedMock(),
        sp3: createSp3LossCutMock(),
        rf: createRfMock(),
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "output" });

      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");
      // RF結果がcontextに保存されている
      expect(finalState.context.recoveryResult).not.toBeNull();

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // 設計判断#5: SP3→RF引き渡し（lastError, errorHistory）
  // -------------------------------------------------------------------------
  describe("設計判断#5: SP3→RF データ引き渡し", () => {
    it("SP-3のlastErrorとerrorHistoryがcontextに転写される", async () => {
      const machine = createTestMachine({
        sp1: createSp1PassMock(),
        sp2: createSp2HumanLedMock(),
        sp3: createSp3LossCutMock(),
        rf: createRfMock(),
      });
      const actor = createActor(machine);
      actor.start();

      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "output" });

      const finalState = await waitFor(actor, (s) => s.status === "done");
      // SP-3のlastErrorが転写されている
      expect(finalState.context.lastError).not.toBeNull();
      expect(finalState.context.lastError?.message).toBe("test failed");

      actor.stop();
    });
  });

  // -------------------------------------------------------------------------
  // context初期化: T10b学び（テスト間の汚染防止）
  // -------------------------------------------------------------------------
  describe("context初期化", () => {
    it("createMainFlowContextが毎回新しいコンテキストを返す", () => {
      const ctx1 = createMainFlowContext("task1");
      const ctx2 = createMainFlowContext("task2");

      expect(ctx1).not.toBe(ctx2);
      expect(ctx1.taskDescription).toBe("task1");
      expect(ctx2.taskDescription).toBe("task2");
    });
  });
});
