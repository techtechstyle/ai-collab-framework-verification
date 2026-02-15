# T9 検証手順書

## 環境セットアップ

```bash
# プロジェクトディレクトリで実行
npm install
```

## 検証コマンド

```bash
# Step 1: 型チェック
npm run typecheck

# Step 2: テスト実行
npm test -- l0l4-hierarchy

# Step 3: 全テスト（将来のタスク追加後）
npm test
```

## 期待される結果

- `npm run typecheck`: エラー0件
- `npm test -- l0l4-hierarchy`: 29テスト全件パス（10不変条件 + 補足テスト）

## 不変条件とテストの対応表

| 不変条件 | テストケース数 | 検証内容 |
|---------|-------------|---------|
| INV-SP1-1 | 1 | 初期状態がl0Check |
| INV-SP1-2 | 4 | L0→L1→L2→L3→passedの逐次遷移 |
| INV-SP1-3 | 4 | 各レベル不合格→failedへの即時遷移 |
| INV-SP1-4 | 3 | 最終状態がpassed/failedの2つのみ |
| INV-SP1-5 | 3 | issues配列によるpass/fail判定 |
| INV-H1 | 2 | 順序保証、逆方向遷移不可 |
| INV-H2 | 3 | 不合格時の下位レベル未評価 |
| INV-H3 | 3 | 全通過時のみallPassed=true |
| INV-H4 | 2 | 上位レベル判断の優先 |
| INV-H5 | 2 | Bright Linesの外部委譲確認 |
| 補足 | 2 | コンテキスト正確性 |
| **合計** | **29** | |

## トラブルシューティング

XState v5の型エラーが出る場合:
- `xstate@5.19.0`以上がインストールされているか確認
- `tsconfig.json`の`moduleResolution`が`bundler`になっているか確認
