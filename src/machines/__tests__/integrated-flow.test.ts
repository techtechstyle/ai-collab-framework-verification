/**
 * T14: 統合フローテスト（INV-CF1〜CF5）
 *
 * 1文説明: T9〜T13で実装した5つのステートマシンを実マシン接続し、
 *          フロー間遷移（Main→SP-1→SP-2→SP-3→LC→RF→Main）の正しさを検証する
 *
 * T10c/T10dとの差分:
 *   T10c/T10d: provide()でサブマシンを即doneモックに置換 → MainFlowの遷移ロジックに集中
 *   T14: 実マシンを接続し、子アクターにイベントを送信 → フロー間のデータ伝搬と遷移を検証
 *
 * 子アクターアクセスパターン（T14で新規確立）:
 *   XState v5のinvokeで起動された子アクターは actor.getSnapshot().children 経由でアクセスし、
 *   子アクターの .send() メソッドで直接イベントを送信する。
 *   テスト#1でこのパターンの技術検証を行う。
 *
 * 対応不変条件: INV-CF1〜CF5
 * 検証方法: npm test -- integrated-flow が全件パスすること
 * 自信度: おそらく（子アクターアクセスパターンは実行未検証）
 */

import { describe, it, expect } from "vitest";
import { createMachine, createActor, waitFor, assign, type AnyActorRef } from "xstate";
import { mainFlowMachine, createMainFlowContext } from "../main-flow";
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
// テストヘルパー: 子アクターアクセス
// =============================================================================

/**
 * T14新規パターン: 親アクターの現在のinvoke子アクターを取得する
 *
 * XState v5では snapshot.children にアクティブな子アクターが Record<string, AnyActorRef> で格納される。
 * invoke状態では通常1つの子アクターのみがアクティブなので、最初の値を返す。
 *
 * 注意: 子アクターが存在しない場合（invokeでない状態）は例外をスローする
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

/**
 * 子アクター一覧のデバッグ出力（技術検証用）
 */
function debugChildren(actor: ReturnType<typeof createActor>): string[] {
  return Object.keys(actor.getSnapshot().children);
}

// =============================================================================
// テストヘルパー: イベントシーケンス
// =============================================================================

/** L0-L3全通過イベントをSP-1子アクターに送信する */
function passAllL0L3(sp1Child: AnyActorRef): void {
  const passResult: LevelResult = { passed: true, issues: [] };
  sp1Child.send({ type: "L0_EVALUATION_COMPLETE", result: passResult });
  sp1Child.send({ type: "L1_EVALUATION_COMPLETE", result: passResult });
  sp1Child.send({ type: "L2_EVALUATION_COMPLETE", result: passResult });
  sp1Child.send({ type: "L3_EVALUATION_COMPLETE", result: passResult });
}

/**
 * SP-2子アクターに人間主導パスのイベントを送信する
 * designDecision → isNotAiStrength=true → 即humanLedExit
 */
function passSp2HumanLed(sp2Child: AnyActorRef): void {
  sp2Child.send({
    type: "TASK_ANALYZED",
    characteristic: "designDecision",
    isAiStrength: false,
  });
  // designDecision → isNotAiStrength guard=true → humanLedExit(final) → 即完了
}

/**
 * SP-3子アクターにtypecheck→lint→test全通過イベントを送信する
 */
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
 * SP-3子アクターにtypecheck失敗→LC→修正継続の1サイクルを送信する
 * 戻り値: SP-3子アクターは再びtypecheck状態に戻っている
 *
 * 重要: 各サイクルで異なるエラーメッセージを使用すること。
 * 同一メッセージを使うと checkRecurringError（LC-GW4）が再発を検出し、
 * errorCount < 3 でも損切り確定してしまう。
 *
 * @param cycle サイクル番号（1, 2, ...）。エラーメッセージの一意化に使用
 */
function failAndContinueSp3Cycle(sp3Child: AnyActorRef, cycle: number): void {
  // typecheck失敗（サイクルごとに異なるメッセージでLC-GW4回避）
  sp3Child.send({
    type: "TYPECHECK_COMPLETE",
    result: {
      passed: false,
      error: { step: "typecheck" as const, message: `type error ${cycle}`, timestamp: Date.now() },
    } as CheckResult,
  });
  // lossCutJudgment.recordErrorState → ERROR_STATE_RECORDED → LC判定
  sp3Child.send({ type: "ERROR_STATE_RECORDED" });
  // LC: errorCount < 3 かつ 再発なし → continueFix → issueFix
  // issueFix → FIX_ISSUED → typecheck（ループ）
  sp3Child.send({ type: "FIX_ISSUED" });
}

/**
 * SP-3子アクターにtypecheck失敗→LC→損切り確定を送信する
 * 前提: errorCount が既に2（3回目の失敗で errorCount=3 → LC-GW1損切りトリガー）
 *
 * ERROR_STATE_RECORDED送信後、check3Times の always ガード（isErrorCount3OrMore）が
 * 自動評価され、lossCutConfirmed → verificationFailed(final) → MainFlow onDone に伝搬する。
 * FIX_ISSUED は不要（SP-3は final に到達済み）。
 *
 * @param cycle サイクル番号（エラーメッセージの一意化に使用）
 */
function failAndTriggerLossCut(sp3Child: AnyActorRef, cycle: number): void {
  // 3回目のtypecheck失敗 → errorCount=3（サイクルごとに異なるメッセージ）
  sp3Child.send({
    type: "TYPECHECK_COMPLETE",
    result: {
      passed: false,
      error: { step: "typecheck" as const, message: `type error ${cycle}`, timestamp: Date.now() },
    } as CheckResult,
  });
  // lossCutJudgment.recordErrorState → ERROR_STATE_RECORDED → check3Times(always)
  // errorCount >= 3 → lossCutConfirmed(final) → SP-3 onDone → MainFlow遷移
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

/**
 * RF子アクターにアプローチB（再分解）パスのイベントを送信する
 * 前提: RFのselectApproachアクションがprovide()でassignに置換済み
 */
function completeRfApproachB(rfChild: AnyActorRef): void {
  // Step 1: 問題分析
  rfChild.send({ type: "PROBLEM_VERBALIZED" });
  rfChild.send({ type: "CAUSE_ANALYZED" });
  rfChild.send({
    type: "ESSENCE_IDENTIFIED",
    analysisResult: createSafeProblemAnalysis(),
  });
  // escalationCheck → needsImmediateEscalation=false → approachSelection
  // selectApproach(assign) → selectedApproach='B' → redecompose

  // Step 2: アプローチB実行
  rfChild.send({ type: "REDECOMPOSE_COMPLETE" });

  // Step 3: 学習記録（INV-RF2: 必須）
  rfChild.send({ type: "CLAUDE_MD_RECORDED" });
  rfChild.send({ type: "WORKAROUND_DOCUMENTED" });
  // teamShareDecision → shouldShareWithTeam=false → recoveryComplete(final)
}

// =============================================================================
// テストヘルパー: モックマシン（T10cパターン再利用）
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

/** SP-3モック: 即損切り（lossCut） */
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

/**
 * RFマシン（実マシン）にselectApproachアクションを注入したバージョンを生成
 * approachSelection状態でselectedApproach='B'(再分解)を自動設定する
 *
 * 理由: RFの selectApproach は外部注入前提のno-opアクション。
 *       provide()しないとselectedApproach=null → フォールバック(D) → ESループの無限ループになる。
 */
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
// T14 テスト
// =============================================================================

describe("T14: 統合フローテスト（INV-CF1〜CF5）", () => {
  // =========================================================================
  // Step 0: 技術検証 — 子アクターアクセスパターン
  // =========================================================================
  describe("技術検証: 子アクターへのイベント送信パターン", () => {
    /**
     * テスト#1: XState v5のinvoke子アクターへのアクセスと直接イベント送信
     *
     * 検証内容:
     *   1. MainFlowがsp1Check状態の時、snapshot.childrenに子アクターが存在する
     *   2. 子アクター（SP-1実マシン）に直接イベント送信できる
     *   3. SP-1が全通過→SP-2に遷移する（onDone伝搬の検証）
     *
     * このテストが失敗する場合、子アクターアクセス方式の見直しが必要
     */
    it("#1: sp1Check状態でSP-1子アクターにアクセスし、L0-L3全通過→SP-2に遷移する", async () => {
      const actor = createActor(mainFlowMachine);
      actor.start();

      // brightLinesCheck → sp1Check
      actor.send({ type: "BRIGHT_LINES_PASS" });

      // sp1Checkに到達確認
      expect(actor.getSnapshot().value).toBe("sp1Check");

      // 子アクター（SP-1実マシン）にアクセス
      const childKeys = debugChildren(actor);
      expect(childKeys.length).toBeGreaterThan(0); // 子アクターが存在する

      const sp1Child = getActiveChild(actor);
      expect(sp1Child).toBeDefined();

      // SP-1にL0-L3全通過イベントを送信
      passAllL0L3(sp1Child);

      // SP-1完了 → MainFlowがsp2Divisionに遷移（onDone伝搬）
      const snapshot = await waitFor(
        actor,
        (s) => s.value !== "sp1Check" && s.value !== "brightLinesCheck"
      );
      expect(snapshot.value).toBe("sp2Division");

      actor.stop();
    });
  });

  // =========================================================================
  // INV-CF1: SP-1→SP-2→SP-3の実行順序固定
  // =========================================================================
  describe("INV-CF1: SP-1→SP-2→SP-3の実行順序固定", () => {
    /**
     * テスト#2: 実SP-1全通過→実SP-2完了→実行フェーズ到達
     *
     * 検証内容:
     *   - SP-1にL0-L3イベントを送信 → SP-1完了 → SP-2にinvokeが切り替わる
     *   - SP-2にタスク分析イベントを送信 → SP-2完了 → humanExecution到達
     *   - 実行順序がSP-1 → SP-2で固定されている
     */
    it("#2: 実SP-1→実SP-2→humanExecution到達（実マシン2段接続）", async () => {
      const testMachine = mainFlowMachine.provide({
        actors: {
          sp3Machine: createMachine({
            id: "sp3Noop",
            initial: "waiting",
            states: { waiting: {} }, // SP-3は起動しないのでダミー
          }),
          rfMachine: createRfMock(),
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // Phase 1: Bright Lines → SP-1
      actor.send({ type: "BRIGHT_LINES_PASS" });
      expect(actor.getSnapshot().value).toBe("sp1Check");

      // Phase 2: SP-1 全通過
      const sp1Child = getActiveChild(actor);
      passAllL0L3(sp1Child);
      const afterSp1 = await waitFor(actor, (s) => s.value === "sp2Division");
      expect(afterSp1.value).toBe("sp2Division");

      // Phase 3: SP-2 人間主導判定
      const sp2Child = getActiveChild(actor);
      passSp2HumanLed(sp2Child);
      const afterSp2 = await waitFor(actor, (s) => s.value === "humanExecution");
      expect(afterSp2.value).toBe("humanExecution");

      // SP-1→SP-2の順序で実行されたことの証拠
      expect(afterSp2.context.sp1Result).not.toBeNull();
      expect(afterSp2.context.sp1Result?.result).toBe("allPass");
      expect(afterSp2.context.sp2Result).not.toBeNull();
      expect(afterSp2.context.sp2Result?.result).toBe("humanLed");

      actor.stop();
    });

    /**
     * テスト#3: SP-1→SP-2→SP-3全通過→taskCompleted（正常完了 end-to-end）
     *
     * 検証内容:
     *   - 3つのサブプロセスが順序通りに実行される
     *   - SP-3のtypecheck→lint→test全通過でtaskCompletedに到達
     *   - 実マシンの全通過パスがend-to-endで動作する
     */
    it("#3: SP-1→SP-2→SP-3全通過→taskCompleted（正常E2E）", async () => {
      const testMachine = mainFlowMachine.provide({
        actors: {
          rfMachine: createRfMock(), // RFは未使用だがprovide必要
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // BL通過 → SP-1
      actor.send({ type: "BRIGHT_LINES_PASS" });

      // SP-1: L0-L3全通過
      const sp1Child = getActiveChild(actor);
      passAllL0L3(sp1Child);
      await waitFor(actor, (s) => s.value === "sp2Division");

      // SP-2: 人間主導
      const sp2Child = getActiveChild(actor);
      passSp2HumanLed(sp2Child);
      await waitFor(actor, (s) => s.value === "humanExecution");

      // 実行
      actor.send({ type: "EXECUTE_HUMAN", output: "integration test output" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // SP-3: typecheck→lint→test全通過
      const sp3Child = getActiveChild(actor);
      passSp3AllChecks(sp3Child);

      // taskCompleted到達
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");
      expect(finalState.output.completionType).toBe("taskCompleted");

      actor.stop();
    });
  });

  // =========================================================================
  // INV-CF2: SP-3の検証失敗はLC（損切り判断）にのみ遷移
  // =========================================================================
  describe("INV-CF2: SP-3検証失敗→LCのみ遷移", () => {
    /**
     * テスト#4: SP-3 typecheck失敗→LC→修正継続→再検証ループ
     *
     * 検証内容:
     *   - SP-3でtypecheck失敗 → LC起動 → errorCount < 3 → 修正継続
     *   - issueFix → FIX_ISSUED → typecheckに戻る（ループ確認）
     *   - ループ後にtypecheck→lint→test全通過 → taskCompleted
     *
     * テスト方式: SP-1/SP-2はモック（即done）、SP-3は実マシン
     */
    it("#4: SP-3失敗→LC→修正継続→ループ→全通過→taskCompleted", async () => {
      const testMachine = mainFlowMachine.provide({
        actors: {
          sp1Machine: createSp1PassMock(),
          sp2Machine: createSp2HumanMock(),
          rfMachine: createRfMock(),
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // SP-1/SP-2モック → humanExecution
      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // SP-3子アクター取得
      const sp3Child = getActiveChild(actor);

      // 1回目の失敗→LC→修正継続→ループ
      failAndContinueSp3Cycle(sp3Child, 1);

      // ループ後、全通過
      passSp3AllChecks(sp3Child);

      // taskCompleted到達
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("taskCompleted");

      actor.stop();
    });

    /**
     * テスト#5: SP-3 3回失敗→LC損切り確定→recoveryFlow遷移
     *
     * 検証内容:
     *   - SP-3でtypecheckを3回失敗 → errorCount=3 → LC損切り確定
     *   - SP-3がverificationFailed(final)到達 → MainFlowがrecoveryFlowに遷移
     *   - INV-CF2: 検証失敗はLCにのみ遷移する（他のサブプロセスには遷移しない）
     *
     * テスト方式: SP-1/SP-2/RFはモック、SP-3は実マシン
     */
    it("#5: SP-3×3失敗→LC損切り確定→recoveryFlow遷移", async () => {
      const testMachine = mainFlowMachine.provide({
        actors: {
          sp1Machine: createSp1PassMock(),
          sp2Machine: createSp2HumanMock(),
          rfMachine: createRfMock(),
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // SP-1/SP-2モック → humanExecution → sp3Verification
      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // SP-3子アクター取得
      const sp3Child = getActiveChild(actor);

      // 1回目・2回目の失敗: LC→修正継続→ループ（異なるメッセージでLC-GW4回避）
      failAndContinueSp3Cycle(sp3Child, 1);
      failAndContinueSp3Cycle(sp3Child, 2);

      // 3回目の失敗: LC-GW1（errorCount >= 3）→損切り確定
      failAndTriggerLossCut(sp3Child, 3);

      // SP-3完了 → RF(モック即done) → recoveryExit
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");
      expect(finalState.output.completionType).toBe("recoveryExit");
      // SP-3からの引き渡しデータがcontextに存在
      expect(finalState.context.lastError).not.toBeNull();
      expect(finalState.context.sp3Result?.lossCut).toBe(true);

      actor.stop();
    });
  });

  // =========================================================================
  // INV-CF3 + INV-CF4: LC→RF一方向、RF完了→メインフロー終了
  // =========================================================================
  describe("INV-CF3+CF4: LC→RF一方向、RF完了→recoveryExit", () => {
    /**
     * テスト#6: 損切り→実RF起動→分析→アプローチB→記録→recoveryExit
     *
     * 検証内容:
     *   - SP-3損切り後にRFが起動される（INV-CF3: LC→RF一方向）
     *   - RF内で問題分析→アプローチ選択→CLAUDE.md記録→回避策記録のフローが完了
     *   - RF完了後にrecoveryExitに到達する（INV-CF4）
     *   - INV-RF2: recordToClaudeMdが必ず通過する
     *
     * テスト方式: SP-1/SP-2はモック、SP-3はモック(即lossCut)、RFは実マシン（selectApproach注入）
     */
    it("#6: SP-3損切り→実RF(分析→アプローチB→記録)→recoveryExit", async () => {
      const testMachine = mainFlowMachine.provide({
        actors: {
          sp1Machine: createSp1PassMock(),
          sp2Machine: createSp2HumanMock(),
          sp3Machine: createSp3LossCutMock(),
          rfMachine: createRfWithApproachB(),
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // SP-1/SP-2/SP-3モック → recoveryFlow
      actor.send({ type: "BRIGHT_LINES_PASS" });
      await waitFor(actor, (s) => s.value === "humanExecution");
      actor.send({ type: "EXECUTE_HUMAN", output: "test" });

      // SP-3モック(lossCut) → recoveryFlowに遷移
      const rfState = await waitFor(actor, (s) => s.value === "recoveryFlow");
      expect(rfState.value).toBe("recoveryFlow");

      // RF子アクターにイベント送信
      const rfChild = getActiveChild(actor);
      completeRfApproachB(rfChild);

      // RF完了 → recoveryExit
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");
      expect(finalState.output.completionType).toBe("recoveryExit");
      expect(finalState.context.recoveryResult).not.toBeNull();
      expect(finalState.context.recoveryResult?.recovered).toBe(true);

      actor.stop();
    });
  });

  // =========================================================================
  // INV-CF1〜CF4: フルパス end-to-end テスト
  // =========================================================================
  describe("INV-CF1〜CF4: フルパス end-to-end", () => {
    /**
     * テスト#7: 全実マシン — BL→SP-1→SP-2→実行→SP-3×3失敗→LC→RF→recoveryExit
     *
     * 検証内容:
     *   - 全サブマシン（SP-1, SP-2, SP-3, RF）が実マシンで接続動作
     *   - INV-CF1: SP-1→SP-2→SP-3の順序
     *   - INV-CF2: SP-3失敗→LCのみに遷移
     *   - INV-CF3: LC→RF一方向
     *   - INV-CF4: RF完了→recoveryExit
     *
     * テスト方式: 全実マシン（RFのみselectApproach注入）
     */
    it("#7: 全実マシンE2E — BL→SP-1→SP-2→実行→SP-3失敗→LC→RF→recoveryExit", async () => {
      const testMachine = mainFlowMachine.provide({
        actors: {
          rfMachine: createRfWithApproachB(),
        },
      });
      const actor = createActor(testMachine);
      actor.start();

      // ---- Phase 1: Bright Lines通過 ----
      actor.send({ type: "BRIGHT_LINES_PASS" });
      expect(actor.getSnapshot().value).toBe("sp1Check");

      // ---- Phase 2: SP-1 L0-L3全通過（実マシン）----
      const sp1Child = getActiveChild(actor);
      passAllL0L3(sp1Child);
      await waitFor(actor, (s) => s.value === "sp2Division");

      // ---- Phase 3: SP-2 人間主導（実マシン）----
      const sp2Child = getActiveChild(actor);
      passSp2HumanLed(sp2Child);
      await waitFor(actor, (s) => s.value === "humanExecution");

      // ---- Phase 4: タスク実行 ----
      actor.send({ type: "EXECUTE_HUMAN", output: "full E2E output" });
      expect(actor.getSnapshot().value).toBe("sp3Verification");

      // ---- Phase 5: SP-3 3回失敗→LC損切り（実マシン）----
      const sp3Child = getActiveChild(actor);
      failAndContinueSp3Cycle(sp3Child, 1); // 1回目: errorCount=1
      failAndContinueSp3Cycle(sp3Child, 2); // 2回目: errorCount=2
      failAndTriggerLossCut(sp3Child, 3);   // 3回目: errorCount=3 → 損切り

      // SP-3完了 → recoveryFlowに遷移
      const rfState = await waitFor(actor, (s) => s.value === "recoveryFlow");
      expect(rfState.value).toBe("recoveryFlow");

      // ---- Phase 6: RF 分析→アプローチB→記録（実マシン）----
      const rfChild = getActiveChild(actor);
      completeRfApproachB(rfChild);

      // ---- Phase 7: 完了確認 ----
      const finalState = await waitFor(actor, (s) => s.status === "done");
      expect(finalState.value).toBe("recoveryExit");
      expect(finalState.output.completionType).toBe("recoveryExit");

      // 全フェーズのcontext転写を確認
      expect(finalState.context.sp1Result?.result).toBe("allPass");
      expect(finalState.context.sp2Result?.result).toBe("humanLed");
      expect(finalState.context.sp3Result?.lossCut).toBe(true);
      expect(finalState.context.recoveryResult?.recovered).toBe(true);
      expect(finalState.context.lastError).not.toBeNull();

      actor.stop();
    });
  });

  // =========================================================================
  // INV-CF5: TD（タスク分解）
  // =========================================================================
  describe("INV-CF5: TD（タスク分解）", () => {
    /**
     * テスト#8: TDは現在未実装
     *
     * INV-CF5: 「TDはT-2からのみ呼び出され、他の要素からの直接呼び出しはない」
     * 現在のXState実装ではTDサブプロセスは未実装。
     * taskAdjustment状態（T-2）にTD invokeを追加するのはStep D完了後の拡張候補。
     */
    it.skip("#8: TDは現在未実装（Step D完了後の拡張候補）", () => {
      // INV-CF5の検証はTDサブプロセス実装後に追加する
    });
  });
});
