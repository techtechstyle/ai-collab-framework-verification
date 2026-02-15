/**
 * T10c+T10d: MainFlow（メインフロー）ステートマシン
 *
 * 1文説明: SP-1/SP-2/SP-3/RFをinvokeで接続し、BPMN §1.2のフロー接続関係を実現する
 *
 * 対応BPMN: SE-1, GW-1〜GW-4, T-1〜T-5, SP-1〜SP-3, EE-1, EE-2
 * 対応不変条件: INV-MF1〜MF6, INV-CF1〜CF5, INV-CA2
 *
 * フロー:
 *   SE-1(brightLinesCheck) → GW-1
 *     GW-1 [違反] → T-1(brightLinesFix) → GW-1（再チェック, INV-MF2）
 *     GW-1 [通過] → SP-1(sp1Check, invoke)
 *   SP-1 → GW-2
 *     GW-2 [不合格] → T-2(taskAdjustment) → SP-1（再チェック, INV-MF3）
 *     GW-2 [合格] → SP-2(sp2Division, invoke, INV-CF1)
 *   SP-2 → GW-3
 *     GW-3 [人間主導] → T-3(humanExecution) → SP-3
 *     GW-3 [AI主導] → T-4(aiExecution) → T-5(humanReview, INV-MF4) → SP-3
 *   SP-3(sp3Verification, invoke)
 *     → [成功] → EE-1(taskCompleted, final)
 *     → [A4違反] → brightLinesCheck（INV-CA2, T10d追加）★
 *     → [損切り] → RF(recoveryFlow, invoke) → EE-2(recoveryExit, final)
 *
 * 設計判断:
 *   #1: サブマシン接続方式 → invoke（output + onDone）
 *   #3: DT-0（Bright Lines）→ イベント + ガード
 *   #4: DT-9 A4違反→DT-0復帰 → SP-3 onDoneの第2分岐（T10d実装）
 *   #5: SP3→RF引き渡し → onDone→context→invoke input
 *   T10b学び: context は関数形式で初期化（テスト間の汚染防止）
 */

import { setup, assign } from "xstate";
import { l0l3CheckMachine } from "./l0l4-hierarchy";
import { sp2DivisionMachine } from "./sp2-division";
import { verificationLoopMachine } from "./verification-loop";
import { recoveryFlowMachine } from "./recovery-flow";
import type {
  MainFlowContext,
  MainFlowEvent,
  MainFlowOutput,
  BrightLineViolation,
  SP2Output,
  SP3OutputExtended,
  RecoveryFlowOutput,
  L0L3CheckOutput,
} from "./types";

/** MainFlow の初期コンテキスト生成（T10b学び: 関数化） */
export function createMainFlowContext(taskDescription: string): MainFlowContext {
  return {
    taskDescription,
    brightLinesResult: { hasViolation: false, violations: [] },
    sp1Result: null,
    adjustmentCount: 0,
    sp2Result: null,
    executionResult: null,
    sp3Result: null,
    lastError: null,
    errorHistory: [],
    recoveryResult: null,
    hasPrincipleViolation: false,
  };
}

export const mainFlowMachine = setup({
  types: {
    context: {} as MainFlowContext,
    events: {} as MainFlowEvent,
    output: {} as MainFlowOutput,
  },
  actors: {
    sp1Machine: l0l3CheckMachine,
    sp2Machine: sp2DivisionMachine,
    sp3Machine: verificationLoopMachine,
    rfMachine: recoveryFlowMachine,
  },
  guards: {
    /** GW-1: Bright Lines違反があるか（DT-0） */
    hasBrightLineViolation: ({ context }) =>
      context.brightLinesResult.hasViolation === true,

    /** GW-2: SP-1の結果が全通過か */
    isSp1AllPass: ({ context }) =>
      context.sp1Result?.result === "allPass",

    /** GW-3: SP-2の結果がAI主導か */
    isSp2AiLed: ({ context }) =>
      context.sp2Result?.result === "aiLed",

    /** GW-4: SP-3が成功か */
    isSp3Pass: ({ context }) =>
      context.sp3Result?.passed === true,
  },
  actions: {
    /** T-1: Bright Lines違反を是正する（外部から注入） */
    fixBrightLines: () => {
      /* Bright Lines是正ロジック: 外部から注入 */
    },
    /** T-2: L0-L3を満たす形にタスクを調整する（外部から注入） */
    adjustTask: () => {
      /* タスク調整ロジック: 外部から注入 */
    },
    /** T-3: 人間主導でタスクを実行する（外部から注入） */
    executeHuman: () => {
      /* 人間主導実行ロジック: 外部から注入 */
    },
    /** T-4: AIに初期案を生成させる（外部から注入） */
    executeAi: () => {
      /* AI実行ロジック: 外部から注入 */
    },
    /** T-5: 人間がAI出力をレビューする（外部から注入） */
    reviewAiOutput: () => {
      /* 人間レビューロジック: 外部から注入 */
    },
  },
}).createMachine({
  id: "mainFlow",
  initial: "brightLinesCheck",
  context: () => createMainFlowContext(""),

  states: {
    // ========================================
    // GW-1: Bright Linesチェック（DT-0）
    // INV-MF1: すべてのタスクはBright Linesチェックを通過後に実行
    // INV-H5: Bright Linesは全レベルに先行
    // ========================================
    brightLinesCheck: {
      on: {
        BRIGHT_LINES_PASS: {
          target: "sp1Check", // INV-MF1: 通過 → SP-1へ
        },
        BRIGHT_LINES_FAIL: {
          actions: assign({
            brightLinesResult: ({ event }) => ({
              hasViolation: true,
              violations: event.violations,
            }),
          }),
          target: "brightLinesFix", // INV-MF2: 違反 → 是正へ
        },
      },
    },

    // ========================================
    // T-1: Bright Lines違反を是正する
    // INV-MF2: 是正完了まで進行しない → GW-1に戻る
    // ========================================
    brightLinesFix: {
      entry: [{ type: "fixBrightLines" }],
      on: {
        BRIGHT_LINES_FIXED: {
          actions: assign({
            brightLinesResult: () => ({
              hasViolation: false,
              violations: [] as BrightLineViolation[],
            }),
          }),
          target: "brightLinesCheck", // INV-MF2: 再チェックループ
        },
      },
    },

    // ========================================
    // SP-1: L0-L3チェック（invoke）
    // INV-CF1: SP-1 → SP-2の順序固定
    // INV-CF2: 独立したコンテキスト
    // ========================================
    sp1Check: {
      invoke: {
        src: "sp1Machine",
        onDone: [
          {
            // GW-2 [合格]: SP-2へ
            guard: ({ event }) => {
              const output = event.output as L0L3CheckOutput;
              return output.allPassed === true;
            },
            actions: assign({
              sp1Result: () => ({
                result: "allPass" as const,
                failedLevel: null,
                evaluatedLevels: 4,
              }),
            }),
            target: "sp2Division", // INV-MF3, INV-CF1
          },
          {
            // GW-2 [不合格]: T-2（タスク調整）へ
            actions: assign({
              sp1Result: () => ({
                result: "failed" as const,
                failedLevel: null, // 簡略化: 詳細レベルはoutputから取得可
                evaluatedLevels: 4,
              }),
            }),
            target: "taskAdjustment", // INV-MF3
          },
        ],
      },
    },

    // ========================================
    // T-2: L0-L3を満たす形にタスクを調整する
    // INV-MF3: 不合格 → 調整 → SP-1再チェック
    // ========================================
    taskAdjustment: {
      entry: [{ type: "adjustTask" }],
      on: {
        ADJUSTMENT_DONE: {
          actions: assign({
            adjustmentCount: ({ context }) => context.adjustmentCount + 1,
            sp1Result: () => null, // 再チェックのためリセット
          }),
          target: "sp1Check", // INV-MF3: SP-1に戻る
        },
      },
    },

    // ========================================
    // SP-2: AIファーストチェック＋分業判断（invoke）
    // INV-CF1: SP-1通過後にのみ到達
    // INV-H3: L4はL0-L3すべて通過後にのみ適用
    // ========================================
    sp2Division: {
      invoke: {
        src: "sp2Machine",
        onDone: [
          {
            // GW-3 [AI主導]: T-4 → T-5 → SP-3
            guard: ({ event }) => {
              const output = event.output as SP2Output;
              return output.result === "aiLed";
            },
            actions: assign({
              sp2Result: ({ event }) => event.output as SP2Output,
            }),
            target: "aiExecution",
          },
          {
            // GW-3 [人間主導]: T-3 → SP-3
            actions: assign({
              sp2Result: ({ event }) => event.output as SP2Output,
            }),
            target: "humanExecution",
          },
        ],
      },
    },

    // ========================================
    // T-3: 人間主導でタスクを実行する
    // INV-MF5: 人間主導パスもSP-3を通過する
    // ========================================
    humanExecution: {
      entry: [{ type: "executeHuman" }],
      on: {
        EXECUTE_HUMAN: {
          actions: assign({
            executionResult: ({ event }) => ({
              output: event.output,
              isAiGenerated: false,
              humanReviewed: true, // 人間主導 = レビュー済み
            }),
          }),
          target: "sp3Verification", // INV-MF5
        },
      },
    },

    // ========================================
    // T-4: AIに初期案を生成させる
    // INV-MF4: AI適用パスではT-5（人間レビュー）が省略不可
    // ========================================
    aiExecution: {
      entry: [{ type: "executeAi" }],
      on: {
        EXECUTE_AI: {
          actions: assign({
            executionResult: ({ event }) => ({
              output: event.output,
              isAiGenerated: true,
              humanReviewed: false, // まだレビューされていない
            }),
          }),
          target: "humanReview", // INV-MF4: T-5は省略不可
        },
      },
    },

    // ========================================
    // T-5: 人間がAI出力をレビューする
    // INV-MF4: AI適用パスで省略不可
    // INV-BL3: コード採用前に人間による理解確認
    // ========================================
    humanReview: {
      entry: [{ type: "reviewAiOutput" }],
      on: {
        HUMAN_REVIEW_DONE: {
          actions: assign({
            executionResult: ({ context, event }) => ({
              ...context.executionResult!,
              humanReviewed: event.approved,
            }),
          }),
          target: "sp3Verification", // INV-MF5
        },
      },
    },

    // ========================================
    // SP-3: 検証フィードバックループ（invoke）
    // INV-MF5: 両パスがSP-3に合流
    // INV-BL2: 本番適用前に検証ステップが存在
    // INV-BL4: AIの出力に対する独立検証
    // INV-CA2: DT-9 A4違反→DT-0復帰（T10d追加）
    // ========================================
    sp3Verification: {
      invoke: {
        src: "sp3Machine",
        onDone: [
          {
            // GW-4 [成功]: EE-1（正常完了）
            guard: ({ event }) => {
              const output = event.output as SP3OutputExtended;
              return output.passed === true;
            },
            actions: assign({
              sp3Result: ({ event }) => event.output as SP3OutputExtended,
            }),
            target: "taskCompleted", // INV-MF6: EE-1
          },
          {
            // T10d: [A4違反] → DT-0（brightLinesCheck）に戻る
            // INV-CA2: DT-9でBright Lines違反検出 → DT-0復帰
            // 設計判断#4: lossCutより優先（BrightLines安全性が最優先）
            guard: ({ event }) => {
              const output = event.output as SP3OutputExtended;
              return output.principleViolation === true;
            },
            actions: assign({
              sp3Result: ({ event }) => event.output as SP3OutputExtended,
              hasPrincipleViolation: () => true,
              // SP-3結果をリセットしない（brightLinesCheckで参照可能にする）
            }),
            target: "brightLinesCheck", // INV-CA2: DT-0に戻る
          },
          {
            // GW-4 [損切り]: RF（復帰フロー）へ
            // 設計判断#5: SP3→RF引き渡し（onDone→context）
            actions: assign({
              sp3Result: ({ event }) => event.output as SP3OutputExtended,
              lastError: ({ event }) =>
                (event.output as SP3OutputExtended).lastError,
              errorHistory: ({ event }) =>
                (event.output as SP3OutputExtended).errorHistory,
            }),
            target: "recoveryFlow", // INV-MF6: EE-2経由
          },
        ],
      },
    },

    // ========================================
    // RF: 復帰フロー（invoke）
    // INV-CF3: LC → RF は一方向
    // INV-CF4: RF完了後はメインフローに戻る
    // ========================================
    recoveryFlow: {
      invoke: {
        src: "rfMachine",
        onDone: {
          actions: assign({
            recoveryResult: ({ event }) =>
              event.output as RecoveryFlowOutput,
          }),
          target: "recoveryExit", // INV-CF4, INV-MF6: EE-2
        },
      },
    },

    // ========================================
    // 最終状態
    // INV-MF6: 終了は2パターンのみ
    // ========================================
    /** EE-1: タスク完了（正常終了） */
    taskCompleted: { type: "final" },
    /** EE-2: 損切り→復帰フロー経由で終了 */
    recoveryExit: { type: "final" },
  },

  // MainFlowの出力（INV-MF6: 完了種別を明示）
  output: ({ context }): MainFlowOutput => ({
    completionType: context.recoveryResult
      ? "recoveryExit"
      : "taskCompleted",
    executionResult: context.executionResult,
    recoveryResult: context.recoveryResult,
  }),
});
