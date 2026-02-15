# T10b: SP-2（分業判断）独立マシン実装

## 1文説明
SP-2（AIファーストチェック＋分業判断）をXStateの独立マシンとして実装し、INV-SP2-1〜SP2-4が通るテストを書く。

## 成果物

| ファイル | 配置先 | 説明 |
|---------|--------|------|
| `sp2-division.ts` | `src/machines/sp2-division.ts` | SP-2マシン本体 |
| `sp2-division.test.ts` | `src/machines/__tests__/sp2-division.test.ts` | テスト（22件） |

## テスト一覧（21件）

| # | describe | テスト名 | 対応不変条件 |
|---|---------|---------|-------------|
| 1 | INV-SP2-1 | 初期状態はanalyzingTask | INV-SP2-1 |
| 2 | INV-SP2-1 | DECIDE_DIVISIONは受け付けない（順序保証） | INV-SP2-1 |
| 3 | INV-SP2-1 | SELECT_PROMPTは受け付けない（順序保証） | INV-SP2-1 |
| 4 | INV-SP2-2 | AI主導判定後、selectingPrompt経由 | INV-SP2-2 |
| 5 | INV-SP2-2 | SELECT_PROMPTで初めてaiLedExitに遷移 | INV-SP2-2 |
| 6 | INV-SP2-3 | AI主導パス: aiLedExit | INV-SP2-3 |
| 7 | INV-SP2-3 | 人間主導パス（GW1経由）: humanLedExit | INV-SP2-3 |
| 8 | INV-SP2-3 | 人間主導パス（GW2経由）: humanLedExit | INV-SP2-3 |
| 9 | INV-SP2-3 | 最終状態は2つのみ | INV-SP2-3 |
| 10 | INV-SP2-4 | initialDraft → GW1通過 | INV-SP2-4 |
| 11 | INV-SP2-4 | styleUnification → GW1通過 | INV-SP2-4 |
| 12 | INV-SP2-4 | gapDetection → GW1通過 | INV-SP2-4 |
| 13 | INV-SP2-4 | designDecision → GW1で即humanLedExit | INV-SP2-4 |
| 14 | INV-SP2-4 | domainSpecific → GW1で即humanLedExit | INV-SP2-4 |
| 15 | INV-SP2-4 | unknown → GW1通過 | INV-SP2-4 |
| 16 | SP2Output | AI主導完了時の出力 | — |
| 17 | SP2Output | 人間主導完了時（GW1経由）の出力 | — |
| 18 | SP2Output | 人間主導完了時（GW2経由）の出力 | — |
| 19 | SP2Output | 各プロンプト技法（DT-7全5種） | INV-DT6 |
| 20 | 結合テスト | AI主導フルパス | — |
| 21 | 結合テスト | 人間主導ショートパス（GW1） | — |
| 22 | 結合テスト | 人間主導ロングパス（GW2） | — |

※ テスト#19は5回ループで5種の技法を検証するが、Vitestでは1テストとしてカウント。

## 設計パターン（T9〜T13との一貫性）

| 項目 | SP-2の採用方式 | 統一パターン |
|------|-------------|------------|
| 状態名 | camelCase（`analyzingTask`等） | ✅ T9〜T13と同じ |
| イベント名 | SCREAMING_SNAKE（`TASK_ANALYZED`等） | ✅ T9〜T13と同じ |
| ガード名 | 関数ベース（`isNotAiStrength`） | ✅ T9と同じ |
| output方式 | contextベース | ✅ T9〜T13で統一 |
| テスト関数 | `it()` | ✅ T11以降で統一 |
| output検証 | `toMatchObject` | ✅ T11以降で統一 |

## 検証方法

```bash
# SP-2テスト単体
npm test -- sp2-division

# 全テスト（119 + SP-2新規22件 = 期待値: 141テスト）
npm test

# 型チェック
npx tsc --noEmit
```

## 自信度: おそらく

**確実な部分:**
- フロー構造（BPMN仕様どおり）
- 不変条件のテストカバレッジ
- 型定義との整合性（T10aで追加済み）

**不確実な部分:**
- XState v5のmutable context更新パターン（`context.xxx = yyy`）が、T9〜T13と同じ方式であることを前提としている。もしT9がassign()を使っている場合は修正が必要
- `createSP2ActorWithContext`ヘルパーは現テストでは未使用（将来のT10c統合テスト用に準備）

## 注意事項

- テストファイル内の未使用ヘルパー `createSP2ActorWithContext` は、T10c（MainFlow統合）で活用予定。現時点で削除しても問題なし
- テスト#19のループ内でactorを生成→停止しているため、テスト順序依存はなし
