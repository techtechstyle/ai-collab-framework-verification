/**
 * L0-L4 階層チェック 型定義
 *
 * 出典: docs/spec-l0l4-hierarchy.md §3.2
 * 命名規則: 状態名=camelCase、イベント名=SCREAMING_SNAKE、ガード名=camelCase
 */

// --- 基本型 ---

/**
 * 各レベルの評価結果
 * DT-2〜DT-5のヒットポリシーC（収集）を反映
 * issues.length > 0 のとき passed = false（INV-SP1-5）
 */
export type LevelResult = {
  passed: boolean;
  /** 要対応項目のリスト（ヒットポリシーC: 収集） */
  issues: string[];
};

/**
 * SP-1（L0-L3チェック）のコンテキスト
 * 仕様書 §3.2 準拠
 */
export type L0L3CheckContext = {
  /** 各レベルの評価結果を保持 */
  evaluationResults: {
    l0: LevelResult | null;
    l1: LevelResult | null;
    l2: LevelResult | null;
    l3: LevelResult | null;
  };
};

// --- イベント型 ---

/**
 * SP-1で使用するイベント
 * 仕様書 §3.4 準拠
 * 命名規則: SCREAMING_SNAKE（設計判断#8）
 */
export type L0L3CheckEvent =
  | { type: "L0_EVALUATION_COMPLETE"; result: LevelResult }
  | { type: "L1_EVALUATION_COMPLETE"; result: LevelResult }
  | { type: "L2_EVALUATION_COMPLETE"; result: LevelResult }
  | { type: "L3_EVALUATION_COMPLETE"; result: LevelResult };

// --- 出力型 ---

/**
 * SP-1の出力（親マシンへの通知）
 * 仕様書 §4.2 準拠（設計判断#7: outputプロパティ方式）
 */
export type L0L3CheckOutput = {
  result: L0L3CheckContext["evaluationResults"];
  allPassed: boolean;
};

// =============================================================================
// T11/T12: 検証ループ（SP-3）＋ 損切り判断（LC）
// 出典: docs/spec-verification-losscut.md
// =============================================================================

// --- エラー関連型（§3.2） ---

export type ErrorInfo = {
  step: "typecheck" | "lint" | "test";
  message: string;
  timestamp: number;
};

export type ErrorRecord = {
  error: ErrorInfo;
  fixAttempt: string;
  /** 修正後のコード複雑度（定性値） */
  complexityDelta: "increased" | "unchanged" | "decreased";
};

export type PrincipleCheckResult = {
  passed: boolean;
  violations: string[];
};

// --- 損切り判断（LC）型 ---

export type LossCutDecision = "continue" | "cut";

/**
 * LC（損切り判断）のコンテキスト
 * VerificationLoopContextのサブセット。LCの単独テストで使用
 */
export type LossCutContext = {
  errorCount: number;
  startedAt: number;
  lastError: ErrorInfo | null;
  errorHistory: ErrorRecord[];
  /** LCの判定結果（final状態遷移時にassignで設定） */
  lossCutDecision: LossCutDecision | null;
};

/** LC内部で使用するイベント（§4.3） */
export type LossCutEvent = { type: "ERROR_STATE_RECORDED" };

/** LCの出力（§4.7） */
export type LossCutOutput = {
  decision: LossCutDecision;
};

// --- 検証ループ（SP-3）型 ---

/** 検証ステップの実行結果 */
export type CheckResult = {
  passed: boolean;
  error?: ErrorInfo;
};

/**
 * SP-3（検証ループ）のコンテキスト（§3.2）
 * LossCutContextを拡張
 */
export type VerificationLoopContext = LossCutContext & {
  currentStep: "typecheck" | "lint" | "test";
  collaborationCheckResult: PrincipleCheckResult | null;
  aiPrincipleCheckResult: PrincipleCheckResult | null;
};

/** SP-3で使用するイベント（§3.4） */
export type VerificationLoopEvent =
  | { type: "TYPECHECK_COMPLETE"; result: CheckResult }
  | { type: "LINT_COMPLETE"; result: CheckResult }
  | { type: "TEST_COMPLETE"; result: CheckResult }
  | { type: "ERROR_STATE_RECORDED" }
  | { type: "FIX_ISSUED" };

/**
 * SP-3の出力（T6 §5.1 SP3Output型に準拠）
 * 設計判断#7: outputプロパティ方式
 */
export type SP3Output = {
  passed: boolean;
  lossCut: boolean;
};

/**
 * SP-3の拡張出力（T10 MainFlowとの統合用）
 * lossCut時にRecoveryFlowへ引き渡すデータを含む
 * 申し送り#1: SP3Output → SP3OutputExtended拡張
 */
export type SP3OutputExtended = SP3Output & {
  /** 直近のエラー情報（RecoveryFlowContext.lastErrorに引き渡し） */
  lastError: ErrorInfo | null;
  /** エラー修正履歴（RecoveryFlowContext.errorHistoryに引き渡し） */
  errorHistory: ErrorRecord[];
  /**
   * T10d: DT-9 A4違反（BrightLines違反）検出フラグ（INV-CA2）
   * trueの場合、MainFlowはbrightLinesCheckに戻る
   */
  principleViolation: boolean;
};

// =============================================================================
// T13: 復帰フロー（RF）＋ エスカレーション判断（ES）
// 出典: docs/spec-recovery-escalation.md
// =============================================================================

// --- 問題分析型（§3.2） ---

export type ProblemAnalysis = {
  /** 問題の言語化結果（RF-T1） */
  verbalization: string;
  /** 原因分析結果（RF-T2） */
  causeAnalysis: string;
  /** 本質の特定結果（RF-T3） */
  essenceIdentification: string;
  /** エスカレーション判断の入力となるフラグ */
  hasSecurityIssue: boolean;
  hasProductionImpact: boolean;
  hasDataLossRisk: boolean;
  retreatCount: number;
  isUnknownCause: boolean;
  isOutOfSkillScope: boolean;
};

/** CLAUDE.mdへの記録内容（§3.2） */
export type FailureRecord = {
  pattern: string;
  workaround: string;
  recordedAt: number;
};

// --- 復帰フロー（RF）型 ---

export type EscalationResult = "escalate" | "self";

/**
 * RF（復帰フロー）のコンテキスト（§3.2）
 */
export type RecoveryFlowContext = {
  /** SP-3から引き継いだ直近のエラー内容 */
  lastError: ErrorInfo | null;
  /** SP-3から引き継いだエラー修正履歴 */
  errorHistory: ErrorRecord[];
  /** Step 1（問題分析）の結果 */
  analysisResult: ProblemAnalysis | null;
  /** 選択されたアプローチ */
  selectedApproach: "A" | "B" | "C" | "D" | null;
  /** エスカレーション判断の結果 */
  escalationResult: EscalationResult | null;
  /** CLAUDE.mdへの記録内容 */
  failureRecord: FailureRecord | null;
  /** チーム共有の判断結果 */
  shouldShareWithTeam: boolean;
};

/** RF/ES内部で使用するイベント（§3.4） */
export type RecoveryFlowEvent =
  | { type: "PROBLEM_VERBALIZED" }
  | { type: "CAUSE_ANALYZED" }
  | { type: "ESSENCE_IDENTIFIED"; analysisResult: ProblemAnalysis }
  | { type: "ESCALATION_DECIDED" }
  | { type: "HUMAN_FIX_COMPLETE" }
  | { type: "AI_EXPLANATION_RECEIVED" }
  | { type: "REDECOMPOSE_COMPLETE" }
  | { type: "CONTEXT_RESET_COMPLETE" }
  | { type: "TEAM_CONSULTED" }
  | { type: "CLAUDE_MD_RECORDED" }
  | { type: "WORKAROUND_DOCUMENTED" }
  | { type: "TEAM_SHARED" };

/** RFの出力（§3.8, 設計判断#7: outputプロパティ方式） */
export type RecoveryFlowOutput = {
  recovered: boolean;
};

// ============================================
// T10a: SP-2（AIファーストチェック＋分業判断）型定義
// ============================================
// 対応BPMN: SP2-SE, SP2-T1〜T3, SP2-GW1〜GW2, SP2-EE-AI, SP2-EE-HM
// 対応DT: DT-6（分業判断）, DT-7（プロンプト技法選択）
// 対応不変条件: INV-SP2-1〜SP2-4

/**
 * DT-6: タスク特性の分類（ヒットポリシーU: 一意）
 * - 各ルールは排他的条件（INV-SP2-4）
 */
export type TaskCharacteristic =
  | "initialDraft" // ルール1: 初期案・たたき台の作成 → AI主導
  | "styleUnification" // ルール2: スタイル統一・規約遵守 → AI主導
  | "gapDetection" // ルール3: 漏れ・抜けの検出 → AI主導
  | "designDecision" // ルール4: 設計判断・アーキテクチャ → 人間主導
  | "domainSpecific" // ルール5: ドメイン固有の判断 → 人間主導
  | "unknown"; // ルール6: 上記以外 → 要判断（プロンプト設計で試行）

/** DT-6: 分業結果 */
export type DivisionResult = "aiLed" | "humanLed";

/**
 * DT-7: プロンプト技法（ヒットポリシーU: 一意）
 * AI主導の場合のみ選択される（INV-DT6）
 */
export type PromptTechnique =
  | "zeroShot" // ルール1: シンプル → そのまま指示
  | "chainOfThought" // ルール2: 中程度 → 段階的に考えさせる
  | "treeOfThoughts" // ルール3: 高い(比較検討) → 分岐を探索
  | "react" // ルール4: 高い(外部参照) → 推論と行動を交互に
  | "selfConsistency"; // ルール5: 最高 → 複数回実行して多数決

/** SP-2 コンテキスト */
export interface SP2Context {
  /** タスクの説明（入力） */
  taskDescription: string;
  /** SP2-T1: タスク特性の分析結果（INV-SP2-1: 分業判断の前に必須） */
  taskCharacteristic: TaskCharacteristic | null;
  /** SP2-GW1: AIの得意分野か？ */
  isAiStrength: boolean | null;
  /** SP2-T2/GW2: 分業結果 */
  divisionResult: DivisionResult | null;
  /** SP2-T3: プロンプト技法（AI主導の場合のみ, INV-SP2-2） */
  promptTechnique: PromptTechnique | null;
}

/** SP-2 イベント */
export type SP2Event =
  | { type: "ANALYZE_TASK" }
  | {
      type: "TASK_ANALYZED";
      characteristic: TaskCharacteristic;
      isAiStrength: boolean;
    }
  | { type: "DECIDE_DIVISION"; result: DivisionResult }
  | { type: "SELECT_PROMPT"; technique: PromptTechnique };

/**
 * SP-2 出力（INV-SP2-3: 結果は二択のみ）
 * invoke onDoneでMainFlowが受け取る
 */
export interface SP2Output {
  /** 分業結果: 'aiLed' | 'humanLed' */
  result: DivisionResult;
  /** プロンプト技法（AI主導の場合のみ非null） */
  promptTechnique: PromptTechnique | null;
  /** タスク特性（MainFlowのcontext転写用） */
  taskCharacteristic: TaskCharacteristic;
}

// ============================================
// T10a: MainFlow（メインフロー）型定義
// ============================================
// 対応BPMN: SE-1, GW-1〜GW-4, T-1〜T-5, SP-1〜SP-3, EE-1, EE-2
// 対応不変条件: INV-MF1〜MF6, INV-CF1〜CF5, INV-CA2

/**
 * DT-0: Bright Lines事前チェック結果
 * ヒットポリシーF（最初一致）: BL1-BL4のいずれか1つでも該当すれば即停止（INV-DT2）
 */
export interface BrightLinesResult {
  /** 違反があるか */
  hasViolation: boolean;
  /** 違反したBright Line（複数可能だが最初一致で停止） */
  violations: BrightLineViolation[];
}

/** Bright Line違反の種類 */
export type BrightLineViolation =
  | "BL1_humanJudgment" // 人間の最終判断権
  | "BL2_preDeployCheck" // 本番適用前の検証
  | "BL3_humanReview" // コード採用前の理解確認
  | "BL4_independentVerify"; // AI出力の独立検証

/** タスク実行結果（T-3: 人間主導 or T-4→T-5: AI主導） */
export interface ExecutionResult {
  /** 実行出力 */
  output: string;
  /** AI生成かどうか */
  isAiGenerated: boolean;
  /** 人間レビュー済みか（INV-MF4: AI適用パスでは省略不可） */
  humanReviewed: boolean;
}

/**
 * MainFlow コンテキスト
 * フロー全体の状態を管理
 */
export interface MainFlowContext {
  /** タスクの説明（SE-1: 入力） */
  taskDescription: string;

  // --- Bright Lines（GW-1）---
  /** DT-0: Bright Linesチェック結果 */
  brightLinesResult: BrightLinesResult;

  // --- SP-1（L0-L3チェック）---
  /** SP-1の出力（invoke onDone経由） */
  sp1Result: {
    result: "allPass" | "failed";
    failedLevel: number | null;
    evaluatedLevels: number;
  } | null;

  // --- T-2（タスク調整）---
  /** SP-1不合格時の調整回数（INV-MF3: 不合格→SP-2に進めない） */
  adjustmentCount: number;

  // --- SP-2（分業判断）---
  /** SP-2の出力（invoke onDone経由） */
  sp2Result: SP2Output | null;

  // --- 実行（T-3 or T-4→T-5）---
  /** タスク実行結果 */
  executionResult: ExecutionResult | null;

  // --- SP-3（検証ループ）---
  /** SP-3の出力（invoke onDone経由） */
  sp3Result: SP3OutputExtended | null;

  // --- SP3→RF引き渡し（設計判断#5）---
  /** 直近のエラー情報（SP3OutputExtended.lastErrorから転写） */
  lastError: ErrorInfo | null;
  /** エラー修正履歴（SP3OutputExtended.errorHistoryから転写） */
  errorHistory: ErrorRecord[];

  // --- RF（復帰フロー）---
  /** RF出力（invoke onDone経由） */
  recoveryResult: RecoveryFlowOutput | null;

  // --- DT-9 A4違反→DT-0復帰（設計判断#4, INV-CA2）---
  /** SP-3でA4違反（BrightLines違反）が検出されたか */
  hasPrincipleViolation: boolean;
}

/** MainFlow イベント */
export type MainFlowEvent =
  // --- Bright Lines ---
  | { type: "START" }
  | { type: "CHECK_BRIGHT_LINES" }
  | { type: "BRIGHT_LINES_PASS" }
  | { type: "BRIGHT_LINES_FAIL"; violations: BrightLineViolation[] }
  | { type: "BRIGHT_LINES_FIXED" }
  // --- SP-1 結果 ---
  | { type: "SP1_PASS" }
  | { type: "SP1_FAIL"; failedLevel: number }
  | { type: "ADJUSTMENT_DONE" }
  // --- SP-2 結果 ---
  | {
      type: "SP2_AI_LED";
      promptTechnique: PromptTechnique;
      taskCharacteristic: TaskCharacteristic;
    }
  | { type: "SP2_HUMAN_LED" }
  // --- 実行 ---
  | { type: "EXECUTE_HUMAN"; output: string }
  | { type: "EXECUTE_AI"; output: string }
  | { type: "HUMAN_REVIEW_DONE"; approved: boolean }
  // --- SP-3 結果 ---
  | { type: "SP3_PASS" }
  | { type: "SP3_LOSSCUT" }
  | { type: "SP3_PRINCIPLE_VIOLATION" }
  // --- RF 結果 ---
  | { type: "RECOVERY_DONE" };

/**
 * MainFlow 出力（INV-MF6: 終了は2パターンのみ）
 * - taskCompleted (EE-1): 正常完了
 * - recoveryExit (EE-2): 損切り→復帰フロー経由
 */
export interface MainFlowOutput {
  /** 完了種別 */
  completionType: "taskCompleted" | "recoveryExit";
  /** タスク実行結果（完了時） */
  executionResult: ExecutionResult | null;
  /** 復帰フロー結果（復帰時） */
  recoveryResult: RecoveryFlowOutput | null;
}
