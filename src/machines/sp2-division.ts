/**
 * SP-2: AIファーストチェック＋分業判断マシン
 *
 * 対応BPMN: SP2-SE, SP2-T1〜T3, SP2-GW1〜GW2, SP2-EE-AI, SP2-EE-HM
 * 対応DT: DT-6（分業判断, ヒットポリシーU: 一意）, DT-7（プロンプト技法選択）
 * 対応不変条件: INV-SP2-1〜SP2-4
 *
 * フロー:
 *   SP2-SE → analyzingTask(SP2-T1) → SP2-GW1
 *     GW1 [No: AI不得意] → humanLedExit(SP2-EE-HM)
 *     GW1 [Yes/不明] → decidingDivision(SP2-T2) → SP2-GW2
 *       GW2 [人間主導] → humanLedExit(SP2-EE-HM)
 *       GW2 [AI主導] → selectingPrompt(SP2-T3) → aiLedExit(SP2-EE-AI)
 */
import { createMachine } from "xstate";
import type {
  SP2Context,
  SP2Event,
  SP2Output,
  TaskCharacteristic,
  DivisionResult,
  PromptTechnique,
} from "./types";

/** SP-2マシンの初期コンテキスト生成 */
export function createSP2Context(taskDescription: string): SP2Context {
  return {
    taskDescription,
    taskCharacteristic: null,
    isAiStrength: null,
    divisionResult: null,
    promptTechnique: null,
  };
}

/**
 * DT-6ガード: AI不得意（設計判断・ドメイン固有）の場合true
 * INV-SP2-4: 各ルールは排他的条件（ヒットポリシーU）
 */
function isNotAiStrength(characteristic: TaskCharacteristic): boolean {
  return (
    characteristic === "designDecision" || characteristic === "domainSpecific"
  );
}

export const sp2DivisionMachine = createMachine({
  id: "sp2Division",
  initial: "analyzingTask",
  context: () => createSP2Context(""),
  types: {
    context: {} as SP2Context,
    events: {} as SP2Event,
    output: {} as SP2Output,
  },
  states: {
    /**
     * SP2-T1: タスク特性を分析する
     * INV-SP2-1: 分業判断の前に必ず実行される
     */
    analyzingTask: {
      on: {
        TASK_ANALYZED: [
          {
            // SP2-GW1 [No: AI不得意] → SP2-EE-HM（人間主導で終了）
            guard: ({ event }) => isNotAiStrength(event.characteristic),
            target: "humanLedExit",
            actions: ({ context, event }) => {
              context.taskCharacteristic = event.characteristic;
              context.isAiStrength = event.isAiStrength;
              context.divisionResult = "humanLed";
            },
          },
          {
            // SP2-GW1 [Yes/不明] → SP2-T2（分業判断へ）
            target: "decidingDivision",
            actions: ({ context, event }) => {
              context.taskCharacteristic = event.characteristic;
              context.isAiStrength = event.isAiStrength;
            },
          },
        ],
      },
    },

    /**
     * SP2-T2: 分業を決定する（DT-6）
     * SP2-GW2: 分業結果の判定
     */
    decidingDivision: {
      on: {
        DECIDE_DIVISION: [
          {
            // SP2-GW2 [人間主導] → SP2-EE-HM
            guard: ({ event }) => event.result === "humanLed",
            target: "humanLedExit",
            actions: ({ context, event }) => {
              context.divisionResult = event.result;
            },
          },
          {
            // SP2-GW2 [AI主導] → SP2-T3（プロンプト技法選択へ）
            // INV-SP2-2: AI主導の場合、SP2-T3は省略できない
            guard: ({ event }) => event.result === "aiLed",
            target: "selectingPrompt",
            actions: ({ context, event }) => {
              context.divisionResult = event.result;
            },
          },
        ],
      },
    },

    /**
     * SP2-T3: プロンプト技法を選択する（DT-7）
     * INV-SP2-2: AI主導パスでは省略不可
     * INV-DT6: DT-7はDT-6でAI主導の場合のみ参照
     */
    selectingPrompt: {
      on: {
        SELECT_PROMPT: {
          target: "aiLedExit",
          actions: ({ context, event }) => {
            context.promptTechnique = event.technique;
          },
        },
      },
    },

    /**
     * SP2-EE-AI: AI主導で実行（最終状態）
     * INV-SP2-3: 結果は二択のみ
     */
    aiLedExit: {
      type: "final" as const,
    },

    /**
     * SP2-EE-HM: 人間主導で実行（最終状態）
     * INV-SP2-3: 結果は二択のみ
     */
    humanLedExit: {
      type: "final" as const,
    },
  },
  // contextベースのoutput方式（T9〜T13で統一済みのパターン）
  output: ({ context }): SP2Output => ({
    result: context.divisionResult ?? "humanLed",
    promptTechnique:
      context.divisionResult === "aiLed" ? context.promptTechnique : null,
    taskCharacteristic: context.taskCharacteristic ?? "unknown",
  }),
});
