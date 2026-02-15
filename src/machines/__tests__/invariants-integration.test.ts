/**
 * T15: Bright Lines / データオブジェクト / 協働原則 統合テスト
 *
 * 1文説明: INV-BL1〜BL3、INV-DO3〜DO6、INV-CA1の不変条件が
 *          統合フローで保証されるテストを書く
 *
 * 対応不変条件: INV-BL1, BL2, BL3, DO3, DO4, DO5, DO6, CA1
 * スコープ外:
 *   - INV-BL4: T14#3で実SP-3検証済み
 *   - INV-DO1: T14#6でrecordToClaudeMd通過済み
 *   - INV-DO2: TD未実装（INV-CF5と同様skip）
 *   - INV-CA2: T10dで5件カバー済み
 *   - INV-CA3: 型レベル制約（ステートマシン遷移テストの対象外）
 *
 * T14との差分:
 *   T14: INV-CF1〜CF5（フロー間接続の遷移順序）
 *   T15: INV-BL/DO/CA（Bright Lines・データ整合性・原則チェックの動作保証）
 *
 * テストヘルパー: T14で確立したパターン（getActiveChild, passAllL0L3等）を再利用
 *
 * 検証方法: npm test -- invariants-integration が全件パスすること
 * 自信度: おそらく
 */

import { describe, it, expect } from "vitest";
import {
  createMachine,
  createActor,
  waitFor,
  assign,
  type AnyActorRef,
} from "xstate";
import { mainFlowMachine } from "../main-flow";
import { verificationLoopMachine } from "../verification-loop";
import { recoveryFlowMachine } from "../recovery-flow";
import type {
  L0L3CheckOutput,
  SP2Output,
  SP3OutputExtended,
  RecoveryFlowOutput,
  LevelResult,
  CheckResult,
  ProblemAnalysis,
} from "../types";

// =============================================================================
// テストヘルパー: 子アクターアクセス（T14パターン再利用）
// =============================================================================

/**
 * 親アクターの現在のinvoke子アクターを取得する（T14#1で技術検証済み）
 */
function getActiveChild(actor: ReturnType<typeof createActor>): AnyActorRef {
  const children = Object.values(actor.getSnapshot().children);
  if (children.length === 0) {
    throw new Error(
      `No active child actor. Current state: ${JSON.stringify(actor.getSnapshot().value)}`
    );
  }
  return children[0] as AnyActorRef;
}

// =============================================================================
// テストヘルパー: イベントシーケンス（T14パターン再利用）
// =============================================================================

/** SP-1子アクターにL0-L3全通過イベントを送信 */
function passAllL0L3(sp1Child: AnyActorRef): void {
  const passResult: LevelResult = { passed: true, issues: [] };
  sp1Child.send({ type: "L0_EVALUATION_COMPLETE", result: passResult });
  sp1Child.send({ type: "L1_EVALUATION_COMPLETE", result: passResult });
  sp1Child.send({ type: "L2_EVALUATION_COMPLETE", result: passResult });
  sp1Child.send({ type: "L3_EVALUATION_COMPLETE", result: passResult });
}

/** SP-3子アクターにtypecheck→lint→test全通過イベントを送信 */
function passSp3AllChecks(sp3Child: AnyActorRef): void {
  sp3Child.send({
    type: "TYPECHECK_COMPLETE",
    result: { passed: true } as CheckResult,
  });
  sp3Child.send({
    type: "LINT_COMPLETE",
    result: { passed: true } as CheckResult,
  });
  sp3Child.send({
    type: "TEST_COMPLETE",
    result: { passed: true } as CheckResult,
  });
}

/**
 * SP-3子アクターにtypecheck失敗→LC→修正継続の1サイクルを送信
 * @param cycle サイクル番号（エラーメッセージ一意化でLC-GW4回避）
 */
function failAndContinueSp3Cycle(
  sp3Child: AnyActorRef,
  cycle: number
): void {
  sp3Child.send({
    type: "TYPECHECK_COMPLETE",
    result: {
      passed: false,
      error: {
        step: "typecheck" as const,
        message: `type error ${cycle}`,
        timestamp: Date.now(),
      },
    } as CheckResult,
  });
  sp3Child.send({ type: "ERROR_STATE_RECORDED" });
  sp3Child.send({ type: "FIX_ISSUED" });
}

/**
 * SP-3子アクターにtypecheck失敗→LC→損切り確定を送信
 * 前提: errorCount が既に2（3回目で errorCount=3 → LC-GW1損切り）
 */
function failAndTriggerLossCut(
  sp3Child: AnyActorRef,
  cycle: number
): void {
  sp3Child.send({
    type: "TYPECHECK_COMPLETE",
    result: {
      passed: false,
      error: {
        step: "typecheck" as const,
        message: `type error ${cycle}`,
        timestamp: Date.now(),
      },
    } as CheckResult,
  });
  sp3Child.send({ type: "ERROR_STATE_RECORDED" });
}

/** テスト用の安全なProblemAnalysis（エスカレーション不要） */
function createSafeProblemAnalysis(): ProblemAnalysis {
  return {
    verbalization: "test problem",
    causeAnalysis: "test cause",
    essenceIdentification: "test essence",
    hasSecurityIssue: false,
    hasProductionImpact: false,
    hasDataLossRisk: false,
    retreatCount: 0,
    isUnknownCause: false,
    isOutOfSkillScope: false,
  };
}

/** RF子アクターにアプローチBパスのイベントを送信 */
function completeRfApproachB(rfChild: AnyActorRef): void {
  rfChild.send({ type: "PROBLEM_VERBALIZED" });
  rfChild.send({ type: "CAUSE_ANALYZED" });
  rfChild.send({
    type: "ESSENCE_IDENTIFIED",
    analysisResult: createSafeProblemAnalysis(),
  });
  rfChild.send({ type: "REDECOMPOSE_COMPLETE" });
  rfChild.send({ type: "CLAUDE_MD_RECORDED" });
  rfChild.send({ type: "WORKAROUND_DOCUMENTED" });
}

// =============================================================================
// テストヘルパー: モックマシン
// =============================================================================

/** SP-1モック: 即allPassed */
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

/** SP-2モック: 即humanLed */
function createSp2HumanMock() {
  return createMachine({
    id: "sp2HumanMock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP2Output => ({
      result: "humanLed",
      promptTechnique: null,
      taskCharacteristic: "designDecision",
    }),
  });
}

/** SP-2モック: 即aiLed（T15新規） */
function createSp2AiLedMock() {
  return createMachine({
    id: "sp2AiMock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP2Output => ({
      result: "aiLed",
      promptTechnique: "zeroShot",
      taskCharacteristic: "initialDraft",
    }),
  });
}

/** SP-3モック: 即損切り */
function createSp3LossCutMock() {
  return createMachine({
    id: "sp3LossCutMock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): SP3OutputExtended => ({
      passed: false,
      lossCut: true,
      lastError: { step: "test", message: "test failed", timestamp: 0 },
      errorHistory: [],
      principleViolation: false,
    }),
  });
}

/** RFモック: 即recovered */
function createRfMock() {
  return createMachine({
    id: "rfMock",
    initial: "done",
    states: { done: { type: "final" as const } },
    output: (): RecoveryFlowOutput => ({ recovered: true }),
  });
}

/** RF実マシン（selectApproach=B注入） */
function createRfWithApproachB() {
  return recoveryFlowMachine.provide({
    actions: {
      selectApproach: assign({
        selectedApproach: () => "B" as const,
      }),
    },
  });
}

// =============================================================================
// テストヘルパー: パスセットアップ（T15新規）
// =============================================================================

/**
 * AIパス共通セットアップ: BL通過→SP-1/SP-2(AI主導)モック→aiExecution到達
 */
function setupAiPath() {
  const testMachine = mainFlowMachine.provide({
    actors: {
      sp1Machine: createSp1PassMock(),
      sp2Machine: createSp2AiLedMock(),
      rfMachine: createRfMock(),
    },
  });
  const actor = createActor(testMachine);
  actor.start();
  actor.send({ type: "BRIGHT_LINES_PASS" });
  return actor;
}

/**
 * 人間主導パス共通セットアップ: BL通過→SP-1/SP-2(人間主導)モック→humanExecution到達
 */
function setupHumanPath() {
  const testMachine = mainFlowMachine.provide({
    actors: {
      sp1Machine: createSp1PassMock(),
      sp2Machine: createSp2HumanMock(),
      rfMachine: createRfMock(),
    },
  });
  const actor = createActor(testMachine);
  actor.start();
  actor.send({ type: "BRIGHT_LINES_PASS" });
  return actor;
}

// =============================================================================
// T15 テスト
// =============================================================================

describe("T15: BL/DO/CA統合テスト", () => {
  // =========================================================================
  // INV-BL: Bright Lines不変条件
  // =========================================================================
  describe("INV-BL: Bright Lines不変条件", () => {
    /**
     * テスト#1: INV-BL1 — AIパスでhumanReview(T-5)の判断結果がcontextに反映
     *
     * 検証内容:
     *   - AIパスでhumanReview状態に必ず到達する
     *   - HUMAN_REVIEW_DONE { approved } がcontext.executionResult.humanReviewedに反映
     *   - 人間の最終判断権がフロー構造で保証される
     *
     * T10cとの差分: T10cはモック検証。本テストはSP-3実マシンを含むE2Eで検証
     */
    it("#1: INV-BL1 — AIパスでhumanReview判断がcontext反映（人間最終判断権）", async () => {
      const actor = setupAiPath();

      // aiExecution到達
      await waitFor(actor, (s) => s.value === "aiExecution");

      // T-4: AI実行
      actor.send({ type: "EXECUTE_AI", output: "AI generated code" });

      // humanReview到達（INV-BL1: 人間レビューステップの存在）
      expect(actor.getSnapshot().value).toBe("humanReview");

      // T-5: 人間がレビューして承認
      actor.send({ type: "HUMAN_REVIEW_DONE", approved: true });

      // SP-3に遷移
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // context検証: 人間の判断がcontextに反映されている
      const ctx = actor.getSnapshot().context;
      expect(ctx.executionResult?.humanReviewed).toBe(true);
      expect(ctx.executionResult?.isAiGenerated).toBe(true);

      // SP-3全通過→正常完了
      const sp3Child = getActiveChild(actor);
      passSp3AllChecks(sp3Child);

      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");

      actor.stop();
    });

    /**
     * テスト#2: INV-BL2 — 人間主導パスもSP-3（検証ステップ）を必ず経由
     *
     * 検証内容:
     *   - 人間主導パス(T-3)でもSP-3に到達する
     *   - SP-3を経由しないとtaskCompletedに到達できない
     *   - 本番適用前の検証ステップが構造的に保証される
     */
    it("#2: INV-BL2 — 人間主導パスもSP-3経由でtaskCompleted（検証ステップ必須）", async () => {
      const actor = setupHumanPath();

      // humanExecution到達
      await waitFor(actor, (s) => s.value === "humanExecution");

      // T-3: 人間主導実行
      actor.send({ type: "EXECUTE_HUMAN", output: "human written code" });

      // SP-3に遷移（INV-BL2: 検証ステップの存在）
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // SP-3全通過→正常完了
      const sp3Child = getActiveChild(actor);
      passSp3AllChecks(sp3Child);

      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");

      actor.stop();
    });

    /**
     * テスト#3: INV-BL3 — AI実行(T-4)後、humanReview(T-5)経由必須
     *
     * 検証内容:
     *   - aiExecution → EXECUTE_AI → humanReview（sp3Verificationではない）
     *   - T-4→T-5→SP-3の遷移順序がフロー構造で強制される
     *   - コード採用前の理解確認が省略不可
     */
    it("#3: INV-BL3 — AI実行後T-5経由必須（T-4→T-5→SP-3順序保証）", async () => {
      const actor = setupAiPath();

      await waitFor(actor, (s) => s.value === "aiExecution");

      // T-4: AI実行
      actor.send({ type: "EXECUTE_AI", output: "AI output" });

      // 遷移先がhumanReview（sp3Verificationではない）
      const stateAfterAiExec = actor.getSnapshot().value;
      expect(stateAfterAiExec).toBe("humanReview");
      expect(stateAfterAiExec).not.toBe("sp3Verification");

      // T-5完了後にSP-3到達
      actor.send({ type: "HUMAN_REVIEW_DONE", approved: true });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      actor.stop();
    });
  });

  // =========================================================================
  // INV-DO: データオブジェクト不変条件
  // =========================================================================
  describe("INV-DO: データオブジェクト不変条件", () => {
    /**
     * テスト#4: INV-DO3 — AI出力(D-3)がhumanReview(T-5)経由後にSP-3に渡る
     *
     * 検証内容:
     *   - T-4で生成されたAI出力(isAiGenerated=true)がcontextに記録
     *   - T-4直後はhumanReviewed=false（まだレビューされていない）
     *   - T-5後にhumanReviewed=trueに更新
     *   - SP-3到達時にexecutionResultが完全（AI生成+レビュー済み）
     */
    it("#4: INV-DO3 — AI出力がhumanReview経由後にSP-3到達（データ整合性）", async () => {
      const actor = setupAiPath();

      await waitFor(actor, (s) => s.value === "aiExecution");

      // T-4: AI出力生成
      actor.send({ type: "EXECUTE_AI", output: "generated code" });

      // T-4直後: isAiGenerated=true, humanReviewed=false
      const ctxAfterAi = actor.getSnapshot().context;
      expect(ctxAfterAi.executionResult?.isAiGenerated).toBe(true);
      expect(ctxAfterAi.executionResult?.humanReviewed).toBe(false);

      // T-5: 人間レビュー承認
      actor.send({ type: "HUMAN_REVIEW_DONE", approved: true });

      // SP-3到達時: humanReviewed=trueに更新済み
      expect(actor.getSnapshot().value).toBe("sp3Verification");
      const ctxAtSp3 = actor.getSnapshot().context;
      expect(ctxAtSp3.executionResult?.isAiGenerated).toBe(true);
      expect(ctxAtSp3.executionResult?.humanReviewed).toBe(true);
      expect(ctxAtSp3.executionResult?.output).toBe("generated code");

      actor.stop();
    });

    /**
     * テスト#5: INV-DO4 — SP-3の検証結果(D-4)がerrorCount/errorHistoryに蓄積
     *
     * 検証内容:
     *   - typecheck失敗時にerrorHistoryにエラー記録が追加される
     *   - 修正継続→再検証→全通過後もerrorHistoryが保持される
     *   - SP-3のoutput経由でMainFlowのsp3Resultに転写される
     *
     * 対応データオブジェクト: D-4（検証結果）
     */
    it("#5: INV-DO4 — SP-3検証結果がerrorHistoryに蓄積しsp3Resultに転写", async () => {
      const actor = setupHumanPath();

      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test code" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      const sp3Child = getActiveChild(actor);

      // 1回目: typecheck失敗→LC→修正継続
      failAndContinueSp3Cycle(sp3Child, 1);

      // ループ後、全通過→正常完了
      passSp3AllChecks(sp3Child);

      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");

      // SP-3のoutputにerrorHistoryが含まれ、MainFlowのsp3Resultに転写
      const sp3Result = finalState.context.sp3Result;
      expect(sp3Result).not.toBeNull();
      expect(sp3Result?.passed).toBe(true);
      // 失敗1回分のerrorHistoryが蓄積されている
      expect(sp3Result?.errorHistory.length).toBeGreaterThanOrEqual(1);
      expect(sp3Result?.errorHistory[0].error.step).toBe("typecheck");
      expect(sp3Result?.errorHistory[0].error.message).toBe("type error 1");

      actor.stop();
    });

    /**
     * テスト#6: INV-DO5 — エラー状態記録(D-6)がLC判定入力として蓄積・損切り時に転写
     *
     * 検証内容:
     *   - 3回の検証失敗でerrorHistoryに3件蓄積
     *   - LC-GW1（errorCount>=3）で損切り確定
     *   - 損切り後、MainFlowのcontext.errorHistoryにSP-3から転写される
     *   - context.lastErrorが最後のエラー情報である
     *
     * 対応データオブジェクト: D-6（エラー状態記録）
     */
    it("#6: INV-DO5 — エラー状態記録がLC判定→損切り後にMainFlowへ転写", async () => {
      const actor = setupHumanPath();

      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test code" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      const sp3Child = getActiveChild(actor);

      // 3回の失敗: LC-GW1で損切り確定
      failAndContinueSp3Cycle(sp3Child, 1);
      failAndContinueSp3Cycle(sp3Child, 2);
      failAndTriggerLossCut(sp3Child, 3);

      // SP-3損切り→RF(モック)→recoveryExit
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");

      // SP-3→MainFlowへのデータ転写を確認
      // errorHistory: 3件（各サイクルのエラー記録）
      expect(finalState.context.errorHistory.length).toBe(3);
      expect(finalState.context.errorHistory[0].error.message).toBe(
        "type error 1"
      );
      expect(finalState.context.errorHistory[1].error.message).toBe(
        "type error 2"
      );
      expect(finalState.context.errorHistory[2].error.message).toBe(
        "type error 3"
      );

      // lastError: 最後のエラー情報
      expect(finalState.context.lastError).not.toBeNull();
      expect(finalState.context.lastError?.message).toBe("type error 3");
      expect(finalState.context.lastError?.step).toBe("typecheck");

      // sp3Result: 損切り確定
      expect(finalState.context.sp3Result?.lossCut).toBe(true);

      actor.stop();
    });

    /**
     * テスト#7: INV-DO6 — RF内でrecordToClaudeMd→documentWorkaround順序でデータ統合
     *
     * 検証内容:
     *   - RF-T9(recordToClaudeMd) → RF-T10(documentWorkaround) の順序実行
     *   - 失敗パターン記録(D-5)がCLAUDE.md(D-1)に追記される形で統合
     *   - provide()でアクションに呼び出し順序追跡を注入して検証
     *
     * テスト方式: SP-1/SP-2モック、SP-3モック(即lossCut)、RF実マシン（追跡付き）
     */
    it("#7: INV-DO6 — RF内recordToClaudeMd→documentWorkaround順序実行", async () => {
      // アクション呼び出し順序を追跡
      const callOrder: string[] = [];
      const rfWithTracking = recoveryFlowMachine.provide({
        actions: {
          selectApproach: assign({
            selectedApproach: () => "B" as const,
          }),
          recordFailurePattern: () => {
            callOrder.push("recordToClaudeMd");
          },
          documentWorkaround: () => {
            callOrder.push("documentWorkaround");
          },
        },
      });

      const testMachine = mainFlowMachine.provide({
        actors: {
          sp1Machine: createSp1PassMock(),
          sp2Machine: createSp2HumanMock(),
          sp3Machine: createSp3LossCutMock(),
          rfMachine: rfWithTracking,
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // SP-1/SP-2/SP-3モック → recoveryFlow
      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test" });

      // SP-3モック(lossCut) → recoveryFlow
      await waitFor(actor, (s) => s.value === "recoveryFlow");

      // RF子アクターにアプローチBパスのイベント送信
      const rfChild = getActiveChild(actor);
      completeRfApproachB(rfChild);

      // 完了待ち
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");

      // 順序検証: recordToClaudeMd → documentWorkaround
      expect(callOrder).toEqual(["recordToClaudeMd", "documentWorkaround"]);

      actor.stop();
    });
  });

  // =========================================================================
  // INV-CA: 協働原則不変条件
  // =========================================================================
  describe("INV-CA: 協働原則不変条件", () => {
    /**
     * テスト#8: INV-CA1 — DT-8/DT-9チェックがSP-3の各ステップentryで実行
     *
     * 検証内容:
     *   - SP-3のtypecheck/lint/testの各状態entryで
     *     checkCollaborationPrinciples(DT-8)とcheckAIPrinciples(DT-9)が実行される
     *   - 全通過時（3ステップ）で各3回ずつ呼び出される
     *   - 協働原則チェックが検証プロセスと並行して常に監視される（INV-SP3-3連動）
     *
     * テスト方式: SP-3のprovide()でアクションにカウンターを注入
     */
    it("#8: INV-CA1 — DT-8/DT-9チェックがSP-3の各ステップentryで実行", async () => {
      // アクション呼び出しカウンター
      let collaborationCheckCount = 0;
      let aiPrincipleCheckCount = 0;

      const sp3WithTracking = verificationLoopMachine.provide({
        actions: {
          checkCollaborationPrinciples: () => {
            collaborationCheckCount++;
          },
          checkAIPrinciples: () => {
            aiPrincipleCheckCount++;
          },
        },
      });

      const testMachine = mainFlowMachine.provide({
        actors: {
          sp1Machine: createSp1PassMock(),
          sp2Machine: createSp2HumanMock(),
          sp3Machine: sp3WithTracking,
          rfMachine: createRfMock(),
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // BL→SP-1/SP-2モック → humanExecution
      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test code" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // SP-3子アクター取得
      const sp3Child = getActiveChild(actor);

      // typecheck entry時点でカウンター確認（typecheck entryで各1回）
      // XState v5ではentry実行後にイベント受付状態になるため、
      // send前の時点でtypecheckのentryは既に実行済み
      expect(collaborationCheckCount).toBe(1);
      expect(aiPrincipleCheckCount).toBe(1);

      // typecheck→lint→test全通過
      passSp3AllChecks(sp3Child);

      // 全通過: typecheck(1回) + lint(1回) + test(1回) = 各3回
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");

      expect(collaborationCheckCount).toBe(3);
      expect(aiPrincipleCheckCount).toBe(3);

      actor.stop();
    });
  });
});
