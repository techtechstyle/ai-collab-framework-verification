/**
 * T11: 検証ループ（SP-3）ステートマシン
 *
 * 1文説明: T7の仕様に基づき、SP-3（typecheck→lint→test + 協働原則entryチェック）を
 *          XState v5で実装し、INV-SP3-1〜SP3-5が通るテストを書く
 *
 * 出典: docs/spec-verification-losscut.md §3, §5, §6
 * 設計判断#2: entry/exitアクション方式（協働原則チェック）
 *
 * 構造:
 *   typecheck (initial) → lint → test → verificationPassed (final)
 *       ↘                  ↘       ↘
 *           lossCutJudgment (LC: compound state)
 *               ├── → continueFix → issueFix → typecheck（ループ）
 *               └── → lossCutConfirmed → verificationFailed (final)
 *
 *   [30分タイマー] → lossCutJudgment（どの子状態からでも強制遷移）
 */

import { setup, assign } from "xstate";
import {
  checkErrorCount3OrMore,
  checkOver30Min,
  checkGrowingComplexity,
  checkRecurringError,
} from "./losscut-judgment";
import type {
  VerificationLoopContext,
  VerificationLoopEvent,
  SP3OutputExtended,
  CheckResult,
  LossCutDecision,
} from "./types";

export const verificationLoopMachine = setup({
  types: {
    context: {} as VerificationLoopContext,
    events: {} as VerificationLoopEvent,
    output: {} as SP3OutputExtended,
  },
  guards: {
    // --- SP-3 検証ステップのガード（§3.5）---
    isTypecheckPass: ({ event }) => {
      const e = event as { type: "TYPECHECK_COMPLETE"; result: CheckResult };
      return e.result.passed === true;
    },
    isLintPass: ({ event }) => {
      const e = event as { type: "LINT_COMPLETE"; result: CheckResult };
      return e.result.passed === true;
    },
    isTestPass: ({ event }) => {
      const e = event as { type: "TEST_COMPLETE"; result: CheckResult };
      return e.result.passed === true;
    },
    // --- SP-3 損切り判断のonDoneガード ---
    isLossCutContinue: ({ context }) => context.lossCutDecision === "continue",

    // --- LC ガード（losscut-judgment.tsのロジックを再利用）---
    isErrorCount3OrMore: ({ context }) => checkErrorCount3OrMore(context),
    isOver30Min: ({ context }) => checkOver30Min(context),
    isGrowingComplexity: ({ context }) => checkGrowingComplexity(context),
    isRecurringError: ({ context }) => checkRecurringError(context),
  },
  actions: {
    // --- SP-3 検証実行アクション（§3.6）---
    runTypecheck: () => {
      /* typecheck実行ロジック: 外部から注入 */
    },
    runLint: () => {
      /* lint実行ロジック: 外部から注入 */
    },
    runTest: () => {
      /* test実行ロジック: 外部から注入 */
    },

    // --- SP-3 原則チェックアクション（§6.1, §6.2 — 設計判断#2）---
    checkCollaborationPrinciples: () => {
      /* DT-8評価ロジック: 外部から注入 */
    },
    checkAIPrinciples: () => {
      /* DT-9評価ロジック: 外部から注入 */
    },

    // --- LC アクション（§4.5）---
    recordCurrentErrorState: () => {
      /* エラー状態記録ロジック: 外部から注入 */
    },

    // --- SP-3 修正指示アクション ---
    issueFixInstruction: () => {
      /* 修正指示生成ロジック: 外部から注入 */
    },
  },
}).createMachine({
  id: "verificationLoop",
  initial: "typecheck",
  context: {
    currentStep: "typecheck",
    errorCount: 0,
    startedAt: Date.now(),
    lastError: null,
    errorHistory: [],
    collaborationCheckResult: null,
    aiPrincipleCheckResult: null,
    lossCutDecision: null,
  },

  // --- SP3-IE1: 30分タイマー（§5.1 — SP-3全体に適用）---
  // INV-LC5: 30分経過でどの子状態からも強制的にLCに遷移
  after: {
    1800000: { target: ".lossCutJudgment" },
  },

  states: {
    // --- typecheck（SP3-T1 + SP3-T5 + SP3-T6）---
    // §3.3: initial状態、§3.7: 遷移表 行1-2
    typecheck: {
      entry: [
        { type: "runTypecheck" },
        { type: "checkCollaborationPrinciples" }, // INV-SP3-3
        { type: "checkAIPrinciples" }, // INV-SP3-3
      ],
      on: {
        TYPECHECK_COMPLETE: [
          {
            guard: "isTypecheckPass",
            target: "lint", // INV-SP3-1, INV-SP3-2
          },
          {
            actions: assign({
              errorCount: ({ context }) => context.errorCount + 1,
              lastError: ({ event }) => {
                const e = event as {
                  type: "TYPECHECK_COMPLETE";
                  result: CheckResult;
                };
                return e.result.error ?? null;
              },
              errorHistory: ({ context, event }) => {
                const e = event as {
                  type: "TYPECHECK_COMPLETE";
                  result: CheckResult;
                };
                return [
                  ...context.errorHistory,
                  {
                    error: e.result.error!,
                    fixAttempt: "",
                    complexityDelta: "unchanged" as const,
                  },
                ];
              },
            }),
            target: "lossCutJudgment", // INV-SP3-4
          },
        ],
      },
    },

    // --- lint（SP3-T2 + SP3-T5 + SP3-T6）---
    // §3.3: 通常状態、§3.7: 遷移表 行3-4
    lint: {
      entry: [
        { type: "runLint" },
        { type: "checkCollaborationPrinciples" }, // INV-SP3-3
        { type: "checkAIPrinciples" }, // INV-SP3-3
      ],
      on: {
        LINT_COMPLETE: [
          {
            guard: "isLintPass",
            target: "test", // INV-SP3-2
          },
          {
            actions: assign({
              errorCount: ({ context }) => context.errorCount + 1,
              lastError: ({ event }) => {
                const e = event as {
                  type: "LINT_COMPLETE";
                  result: CheckResult;
                };
                return e.result.error ?? null;
              },
              errorHistory: ({ context, event }) => {
                const e = event as {
                  type: "LINT_COMPLETE";
                  result: CheckResult;
                };
                return [
                  ...context.errorHistory,
                  {
                    error: e.result.error!,
                    fixAttempt: "",
                    complexityDelta: "unchanged" as const,
                  },
                ];
              },
            }),
            target: "lossCutJudgment", // INV-SP3-4
          },
        ],
      },
    },

    // --- test（SP3-T3 + SP3-T5 + SP3-T6）---
    // §3.3: 通常状態、§3.7: 遷移表 行5-6
    test: {
      entry: [
        { type: "runTest" },
        { type: "checkCollaborationPrinciples" }, // INV-SP3-3
        { type: "checkAIPrinciples" }, // INV-SP3-3
      ],
      on: {
        TEST_COMPLETE: [
          {
            guard: "isTestPass",
            target: "verificationPassed", // INV-SP3-5
          },
          {
            actions: assign({
              errorCount: ({ context }) => context.errorCount + 1,
              lastError: ({ event }) => {
                const e = event as {
                  type: "TEST_COMPLETE";
                  result: CheckResult;
                };
                return e.result.error ?? null;
              },
              errorHistory: ({ context, event }) => {
                const e = event as {
                  type: "TEST_COMPLETE";
                  result: CheckResult;
                };
                return [
                  ...context.errorHistory,
                  {
                    error: e.result.error!,
                    fixAttempt: "",
                    complexityDelta: "unchanged" as const,
                  },
                ];
              },
            }),
            target: "lossCutJudgment", // INV-SP3-4
          },
        ],
      },
    },

    // --- 損切り判断（LC: compound state）---
    // §4: LC詳細仕様。ガード関数はlosscut-judgment.tsから再利用
    lossCutJudgment: {
      initial: "recordErrorState",
      states: {
        // LC-T1: エラー状態の記録（INV-LC1）
        recordErrorState: {
          entry: [{ type: "recordCurrentErrorState" }],
          on: {
            ERROR_STATE_RECORDED: { target: "check3Times" },
          },
        },
        // LC-GW1: 3回ルール（INV-LC4: 短絡評価の第1条件）
        check3Times: {
          always: [
            {
              guard: "isErrorCount3OrMore",
              actions: assign({
                lossCutDecision: () => "cut" as LossCutDecision,
              }),
              target: "lossCutConfirmed",
            },
            { target: "check30Min" },
          ],
        },
        // LC-GW2: 時間ルール（INV-LC4: 第2条件）
        check30Min: {
          always: [
            {
              guard: "isOver30Min",
              actions: assign({
                lossCutDecision: () => "cut" as LossCutDecision,
              }),
              target: "lossCutConfirmed",
            },
            { target: "checkComplexity" },
          ],
        },
        // LC-GW3: 複雑化ルール（INV-LC4: 第3条件）
        checkComplexity: {
          always: [
            {
              guard: "isGrowingComplexity",
              actions: assign({
                lossCutDecision: () => "cut" as LossCutDecision,
              }),
              target: "lossCutConfirmed",
            },
            { target: "checkRecurrence" },
          ],
        },
        // LC-GW4: 再発ルール（INV-LC4: 第4条件）
        checkRecurrence: {
          always: [
            {
              guard: "isRecurringError",
              actions: assign({
                lossCutDecision: () => "cut" as LossCutDecision,
              }),
              target: "lossCutConfirmed",
            },
            {
              actions: assign({
                lossCutDecision: () => "continue" as LossCutDecision,
              }),
              target: "continueFix",
            },
          ],
        },
        continueFix: { type: "final" },
        lossCutConfirmed: { type: "final" },
      },

      // LC完了時の分岐（§3.7: 遷移表 行7-8）
      onDone: [
        {
          guard: "isLossCutContinue",
          target: "issueFix", // INV-LC3: 修正継続
        },
        {
          target: "verificationFailed", // INV-LC2: 損切り確定
        },
      ],
    },

    // --- 修正指示（LC-T2）---
    // §3.7: 遷移表 行9
    issueFix: {
      entry: [{ type: "issueFixInstruction" }],
      on: {
        FIX_ISSUED: {
          actions: assign({
            currentStep: () => "typecheck" as const,
            lossCutDecision: () => null, // 次のLC判定のためにリセット
          }),
          target: "typecheck", // MR-9: ループ
        },
      },
    },

    // --- 最終状態 ---
    verificationPassed: { type: "final" }, // SP3-EE-OK
    verificationFailed: { type: "final" }, // SP3-EE-NG
  },

  // §3.8: SP-3の出力（T6 §5.1 SP3Output型に準拠 + T10d: principleViolation追加）
  // verificationPassed到達時: lossCutDecision === null → passed: true
  // verificationFailed到達時: lossCutDecision === 'cut' → lossCut: true
  // principleViolation: DT-9 A4違反（BrightLines違反）検出時にtrue（INV-CA2）
  output: ({ context }) => ({
    passed: context.lossCutDecision !== "cut",
    lossCut: context.lossCutDecision === "cut",
    lastError: context.lastError,
    errorHistory: context.errorHistory,
    principleViolation:
      context.aiPrincipleCheckResult !== null &&
      context.aiPrincipleCheckResult.passed === false,
  }),
});

/**
 * 実装判断: SP-3の output
 *
 * 仕様書§3.8では self.getSnapshot().matches() を使用しているが、
 * XState v5の output 関数内での self 参照に制約があるため、
 * context.lossCutDecision ベースで判定する方式に変更。
 *
 * - verificationPassed 到達時: lossCutDecision は null（LCを経由していない or issueFixでリセット済み）
 * - verificationFailed 到達時: lossCutDecision は 'cut'（LCで設定済み）
 */
