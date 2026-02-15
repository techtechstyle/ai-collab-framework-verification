/**
 * SP-2（AIファーストチェック＋分業判断）テスト
 *
 * 対応不変条件: INV-SP2-1〜SP2-4
 * テスト規約: it()で統一、output検証はtoMatchObject
 */
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { sp2DivisionMachine, createSP2Context } from '../sp2-division';
import type { SP2Output } from '../types';

/** テスト用ヘルパー: 指定contextでアクターを生成 */
function createSP2Actor(taskDescription = 'テストタスク') {
  return createActor(sp2DivisionMachine, {
    input: undefined,
    snapshot: undefined,
  }).start();
}

/** テスト用ヘルパー: contextを指定してアクターを生成 */
function createSP2ActorWithContext(taskDescription: string) {
  return createActor(
    sp2DivisionMachine.provide({
      // contextをオーバーライド
    }),
    {
      snapshot: sp2DivisionMachine.resolveState({
        value: 'analyzingTask',
        context: createSP2Context(taskDescription),
      }),
    }
  ).start();
}

describe('SP-2: AIファーストチェック＋分業判断', () => {
  // ========================================
  // INV-SP2-1: タスク特性の分析は分業判断の前に必ず実行される
  // ========================================
  describe('INV-SP2-1: タスク特性分析は分業判断に先行する', () => {
    it('初期状態はanalyzingTask（SP2-T1）である', () => {
      const actor = createSP2Actor();
      expect(actor.getSnapshot().value).toBe('analyzingTask');
      actor.stop();
    });

    it('analyzingTask状態でDECIDE_DIVISIONイベントは受け付けない（順序保証）', () => {
      const actor = createSP2Actor();
      // SP2-T1をスキップしてSP2-T2に直接遷移しようとする
      actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });
      // 状態は変わらない（analyzingTaskのまま）
      expect(actor.getSnapshot().value).toBe('analyzingTask');
      actor.stop();
    });

    it('analyzingTask状態でSELECT_PROMPTイベントは受け付けない（順序保証）', () => {
      const actor = createSP2Actor();
      actor.send({ type: 'SELECT_PROMPT', technique: 'zeroShot' });
      expect(actor.getSnapshot().value).toBe('analyzingTask');
      actor.stop();
    });
  });

  // ========================================
  // INV-SP2-2: AI主導の場合、プロンプト技法選択は省略できない
  // ========================================
  describe('INV-SP2-2: AI主導パスではプロンプト技法選択が必須', () => {
    it('AI主導判定後、selectingPrompt状態を経由する', () => {
      const actor = createSP2Actor();
      // SP2-T1: タスク特性分析（AI得意分野）
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'initialDraft',
        isAiStrength: true,
      });
      expect(actor.getSnapshot().value).toBe('decidingDivision');

      // SP2-T2/GW2: AI主導判定
      actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });
      expect(actor.getSnapshot().value).toBe('selectingPrompt');

      // まだ最終状態ではない（SP2-T3が必須）
      expect(actor.getSnapshot().status).not.toBe('done');
      actor.stop();
    });

    it('selectingPromptでSELECT_PROMPTを送ると初めてaiLedExitに遷移する', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'initialDraft',
        isAiStrength: true,
      });
      actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });
      actor.send({ type: 'SELECT_PROMPT', technique: 'chainOfThought' });

      expect(actor.getSnapshot().value).toBe('aiLedExit');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    });
  });

  // ========================================
  // INV-SP2-3: 結果は二択のみ（AI主導/人間主導）
  // ========================================
  describe('INV-SP2-3: 分業結果は二択のみ', () => {
    it('AI主導パス: 最終状態はaiLedExit', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'gapDetection',
        isAiStrength: true,
      });
      actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });
      actor.send({ type: 'SELECT_PROMPT', technique: 'chainOfThought' });

      expect(actor.getSnapshot().value).toBe('aiLedExit');
      expect(actor.getSnapshot().status).toBe('done');

      const output = actor.getSnapshot().output as SP2Output;
      expect(output.result).toBe('aiLed');
      actor.stop();
    });

    it('人間主導パス（GW1経由）: 最終状態はhumanLedExit', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'designDecision',
        isAiStrength: false,
      });

      expect(actor.getSnapshot().value).toBe('humanLedExit');
      expect(actor.getSnapshot().status).toBe('done');

      const output = actor.getSnapshot().output as SP2Output;
      expect(output.result).toBe('humanLed');
      actor.stop();
    });

    it('人間主導パス（GW2経由）: 最終状態はhumanLedExit', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'unknown',
        isAiStrength: false,
      });
      // GW1は通過（unknownはAI不得意リストに入っていない）
      expect(actor.getSnapshot().value).toBe('decidingDivision');

      actor.send({ type: 'DECIDE_DIVISION', result: 'humanLed' });

      expect(actor.getSnapshot().value).toBe('humanLedExit');
      expect(actor.getSnapshot().status).toBe('done');

      const output = actor.getSnapshot().output as SP2Output;
      expect(output.result).toBe('humanLed');
      actor.stop();
    });

    it('最終状態はaiLedExitまたはhumanLedExitの2つのみ', () => {
      // マシン定義から最終状態を抽出して検証
      const states = sp2DivisionMachine.config.states;
      const finalStates = Object.entries(states!)
        .filter(([_, config]) => (config as any).type === 'final')
        .map(([name]) => name);

      expect(finalStates).toHaveLength(2);
      expect(finalStates).toContain('aiLedExit');
      expect(finalStates).toContain('humanLedExit');
    });
  });

  // ========================================
  // INV-SP2-4: DT-6の各ルールは排他的条件（ヒットポリシーU）
  // ========================================
  describe('INV-SP2-4: タスク特性ごとに一意の分岐', () => {
    it('initialDraft → GW1通過（AI得意）', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'initialDraft',
        isAiStrength: true,
      });
      expect(actor.getSnapshot().value).toBe('decidingDivision');
      actor.stop();
    });

    it('styleUnification → GW1通過（AI得意）', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'styleUnification',
        isAiStrength: true,
      });
      expect(actor.getSnapshot().value).toBe('decidingDivision');
      actor.stop();
    });

    it('gapDetection → GW1通過（AI得意）', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'gapDetection',
        isAiStrength: true,
      });
      expect(actor.getSnapshot().value).toBe('decidingDivision');
      actor.stop();
    });

    it('designDecision → GW1で即humanLedExit（AI不得意）', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'designDecision',
        isAiStrength: false,
      });
      expect(actor.getSnapshot().value).toBe('humanLedExit');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    });

    it('domainSpecific → GW1で即humanLedExit（AI不得意）', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'domainSpecific',
        isAiStrength: false,
      });
      expect(actor.getSnapshot().value).toBe('humanLedExit');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    });

    it('unknown → GW1通過（要判断 = AI不得意リストに含まれない）', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'unknown',
        isAiStrength: false,
      });
      expect(actor.getSnapshot().value).toBe('decidingDivision');
      actor.stop();
    });
  });

  // ========================================
  // 出力検証: SP2Output
  // ========================================
  describe('SP2Output: invoke onDone用の出力', () => {
    it('AI主導完了時: result=aiLed, promptTechnique=選択値, taskCharacteristic=分析値', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'initialDraft',
        isAiStrength: true,
      });
      actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });
      actor.send({ type: 'SELECT_PROMPT', technique: 'zeroShot' });

      const output = actor.getSnapshot().output as SP2Output;
      expect(output).toMatchObject({
        result: 'aiLed',
        promptTechnique: 'zeroShot',
        taskCharacteristic: 'initialDraft',
      });
      actor.stop();
    });

    it('人間主導完了時（GW1経由）: result=humanLed, promptTechnique=null', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'designDecision',
        isAiStrength: false,
      });

      const output = actor.getSnapshot().output as SP2Output;
      expect(output).toMatchObject({
        result: 'humanLed',
        promptTechnique: null,
        taskCharacteristic: 'designDecision',
      });
      actor.stop();
    });

    it('人間主導完了時（GW2経由）: result=humanLed, promptTechnique=null', () => {
      const actor = createSP2Actor();
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'unknown',
        isAiStrength: false,
      });
      actor.send({ type: 'DECIDE_DIVISION', result: 'humanLed' });

      const output = actor.getSnapshot().output as SP2Output;
      expect(output).toMatchObject({
        result: 'humanLed',
        promptTechnique: null,
        taskCharacteristic: 'unknown',
      });
      actor.stop();
    });

    it('各プロンプト技法が正しく出力される（DT-7全5種）', () => {
      const techniques: Array<{ technique: string; name: string }> = [
        { technique: 'zeroShot', name: 'Zero-shot' },
        { technique: 'chainOfThought', name: 'Chain of Thought' },
        { technique: 'treeOfThoughts', name: 'Tree of Thoughts' },
        { technique: 'react', name: 'ReAct' },
        { technique: 'selfConsistency', name: 'Self-consistency' },
      ];

      for (const { technique } of techniques) {
        const actor = createSP2Actor();
        actor.send({
          type: 'TASK_ANALYZED',
          characteristic: 'initialDraft',
          isAiStrength: true,
        });
        actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });
        actor.send({ type: 'SELECT_PROMPT', technique: technique as any });

        const output = actor.getSnapshot().output as SP2Output;
        expect(output.promptTechnique).toBe(technique);
        actor.stop();
      }
    });
  });

  // ========================================
  // フロー全体の結合テスト
  // ========================================
  describe('フロー全体: 正常パスの結合テスト', () => {
    it('AI主導フルパス: analyzingTask → decidingDivision → selectingPrompt → aiLedExit', () => {
      const actor = createSP2Actor();

      // SP2-T1
      expect(actor.getSnapshot().value).toBe('analyzingTask');
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'styleUnification',
        isAiStrength: true,
      });

      // SP2-T2/GW2
      expect(actor.getSnapshot().value).toBe('decidingDivision');
      actor.send({ type: 'DECIDE_DIVISION', result: 'aiLed' });

      // SP2-T3
      expect(actor.getSnapshot().value).toBe('selectingPrompt');
      actor.send({ type: 'SELECT_PROMPT', technique: 'treeOfThoughts' });

      // SP2-EE-AI
      expect(actor.getSnapshot().value).toBe('aiLedExit');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    });

    it('人間主導ショートパス（GW1）: analyzingTask → humanLedExit', () => {
      const actor = createSP2Actor();

      expect(actor.getSnapshot().value).toBe('analyzingTask');
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'domainSpecific',
        isAiStrength: false,
      });

      // SP2-T2, SP2-T3をスキップして直接終了
      expect(actor.getSnapshot().value).toBe('humanLedExit');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    });

    it('人間主導ロングパス（GW2）: analyzingTask → decidingDivision → humanLedExit', () => {
      const actor = createSP2Actor();

      expect(actor.getSnapshot().value).toBe('analyzingTask');
      actor.send({
        type: 'TASK_ANALYZED',
        characteristic: 'unknown',
        isAiStrength: false,
      });

      expect(actor.getSnapshot().value).toBe('decidingDivision');
      actor.send({ type: 'DECIDE_DIVISION', result: 'humanLed' });

      // SP2-T3をスキップして終了
      expect(actor.getSnapshot().value).toBe('humanLedExit');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    });
  });
});
