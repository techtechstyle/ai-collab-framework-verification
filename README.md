# AI協働開発フレームワーク — ステートマシン形式検証

[AI協働開発フレームワーク](https://github.com/techtechstyle/ai-collaborative-dev-framework)の判断フローが設計通りに動作することを、XState v5のステートマシンとして実装し、形式的に検証するプロジェクトです。

## 概要

フレームワークのBPMN形式定義（Phase 1）で定義された69個の不変条件に対して、XStateステートマシンによるテスト実装で検証しています。

- **不変条件カバレッジ**: 62/69（89.9%）、実装対象は100%
- **テスト総数**: 161テスト + 1 skip
- **テストフレームワーク**: Vitest

## ディレクトリ構成

```
ai-collab-framework-verification/
├── src/
│   ├── machines/
│   │   ├── types.ts                    # 全マシン共通型定義
│   │   ├── l0l4-hierarchy.ts           # SP-1（L0-L3チェック）
│   │   ├── sp2-division.ts             # SP-2（分業判断）
│   │   ├── verification-loop.ts        # SP-3（検証ループ）
│   │   ├── losscut-judgment.ts         # LC（損切り判断）
│   │   ├── recovery-flow.ts            # RF（復帰フロー）+ ES
│   │   ├── main-flow.ts               # MainFlow（統合）
│   │   └── __tests__/
│   │       ├── l0l4-hierarchy.test.ts      # T9:  29テスト
│   │       ├── sp2-division.test.ts        # T10a: 22テスト
│   │       ├── verification-loop.test.ts   # T11: 28テスト
│   │       ├── losscut-judgment.test.ts    # T12: 19テスト
│   │       ├── recovery-flow.test.ts       # T13: 29テスト
│   │       ├── main-flow.test.ts           # T10c: 14テスト
│   │       ├── main-flow-t10d.test.ts      # T10d: 5テスト
│   │       ├── integrated-flow.test.ts     # T14: 7テスト+1skip
│   │       └── invariants-integration.test.ts  # T15: 8テスト
│   └── learning/
│       ├── delay-example.ts        # XState遅延遷移の実装
│       ├── history-example.ts      # XState履歴状態の実装
│       └── __tests__/
│           ├── delay-example.test.ts   # XState遅延遷移の学習
│           └── history-example.test.ts # XState履歴状態の学習
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## ステートマシン構成

| マシン | 対応フロー | 不変条件 |
|--------|-----------|---------|
| L0-L4 Hierarchy | SP-1（L0-L3チェック） | INV-H1〜H5, INV-SP1-1〜SP1-5 |
| SP-2 Division | SP-2（AIファーストチェック＋分業判断） | INV-SP2-1〜SP2-4 |
| Verification Loop | SP-3（検証フィードバックループ） | INV-SP3-1〜SP3-5 |
| Losscut Judgment | LC（損切り判断） | INV-LC1〜LC5 |
| Recovery Flow | RF（復帰フロー）+ ES（エスカレーション） | INV-RF1〜RF6, INV-ES1〜ES3 |
| Main Flow | メインフロー（全体統合） | INV-MF1〜MF6, INV-CF1〜CF5 |

## セットアップ

```bash
npm install
```

## テスト実行

```bash
# 全テスト実行
npm test

# 型チェック
npm run typecheck

# 個別マシンのテスト
npm test -- l0l4-hierarchy
npm test -- verification-loop
npm test -- integrated-flow
```

## 関連ドキュメント

設計仕様書・不変条件カバレッジレポートは[フレームワーク本体リポジトリ](https://github.com/techtechstyle/ai-collaborative-dev-framework)の `docs/` に配置しています。

| ドキュメント | 内容 |
|-------------|------|
| `docs/xstate-concepts-mapping.md` | XState概念マッピング |
| `docs/bpmn-to-statechart-mapping.md` | BPMN→ステートチャート変換ルール |
| `docs/spec-l0l4-hierarchy.md` | L0-L4階層仕様 |
| `docs/spec-main-flow.md` | メインフロー+SP-2仕様 |
| `docs/spec-verification-losscut.md` | 検証ループ+損切り仕様 |
| `docs/spec-recovery-escalation.md` | 復帰フロー+ES仕様 |
| `docs/invariant-coverage-report.md` | 不変条件カバレッジレポート（T16） |

## 未実装（Phase 3以降の候補）

- **TD（タスク分解）マシン**: INV-TD1〜TD4（4件）が未カバー
- **TLA+形式検証**: ステートマシンの数学的検証
- **XState Visualizer連携**: インタラクティブ可視化

## ライセンス

MIT
