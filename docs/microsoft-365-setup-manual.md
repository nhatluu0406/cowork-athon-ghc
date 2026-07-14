# Microsoft 365 設定マニュアル

m365-knowledge-graph バックエンドでの Microsoft 365 連携設定手順を説明します。

---

## 1. 概要

このマニュアルは、m365-knowledge-graph バックエンドを Microsoft 365 データソース（OneDrive、Teams など）に接続する方法を説明しています。

### 3 つの接続方法

1. **Microsoft 365 クラウド設定**（推奨）
   - Azure AD アプリ登録による認証
   - クラウドの OneDrive・Teams にリアルタイムで接続
   - 権限フィルタリング対応

2. **OneDrive drive_id 直接指定**（クラウド接続が困難な場合）
   - M365 テナント接続なしに特定フォルダを指定
   - 基本的な同期機能は利用可能

3. **ローカル OneDrive フォルダ**（開発環境・オフライン環境）
   - Windows PC のローカル同期フォルダを参照
   - オフライン環境での動作確認に有効

---

## 2. 前提条件

- **OS**: Windows 10/11 または Linux（Docker コンテナ推奨）
- **Go 1.21 以上**: バックエンドの実行
- **PostgreSQL 12 以上**: メタデータストレージ
- **Neo4j 4.0 以上**: ナレッジグラフストレージ
- **Microsoft 365 テナント**（クラウド設定の場合）
  - Azure AD でのアプリ登録権限
  - SharePoint/OneDrive/Teams 対象リソースへのアクセス

---

## 3. Azure AD / Microsoft Entra ID でのアプリ登録（通常設定）

### 3.1 アプリ登録手順

1. **Azure Portal にサインイン**  
   [https://portal.azure.com](https://portal.azure.com)

2. **「Azure Active Directory」→「アプリ登録」を選択**

3. **「新規登録」をクリック**
   - **名前**: 例 `m365-knowledge-graph-backend`
   - **サポートされているアカウントの種類**: 「この組織ディレクトリのみ内のアカウント（シングルテナント）」
   - **リダイレクト URI**: 後述の `OAUTH_REDIRECT_URI` 環境変数と一致させる
     ```
     http://localhost:8080/auth/callback
     ```

4. **登録後、「概要」ページから以下をコピー**
   - **アプリケーション（クライアント）ID** → `M365_CLIENT_ID`
   - **ディレクトリ（テナント）ID** → `M365_TENANT_ID`

### 3.2 クライアントシークレットの作成

1. **「証明書とシークレット」を選択**

2. **「新しいクライアントシークレット」をクリック**
   - **説明**: 例 `backend-secret`
   - **有効期限**: 環境に合わせて選択（本番は 24 ヶ月以上推奨）

3. **生成されたシークレットを即座にコピー**
   - ⚠️ **この値は二度と表示されません** → `M365_CLIENT_SECRET` として保存

### 3.3 必要な API アクセス許可

1. **「API のアクセス許可」を選択**

2. **「アクセス許可を追加」をクリック**

3. **以下の権限を追加**（Microsoft Graph）

   | 権限 | タイプ | 説明 |
   |---|---|---|
   | `User.Read` | デリゲート | ユーザー情報の読み取り |
   | `Mail.Read` | デリゲート | メールアイテムの読み取り |
   | `Mail.Read.Shared` | デリゲート | 共有メール フォルダの読み取り |
   | `offline_access` | デリゲート | トークン更新用 |
   | `https://graph.microsoft.com/.default` | アプリケーション | バックグラウンド同期用（app-only） |

4. **管理者の同意を付与**
   - 「\<テナント名\> に管理者の同意を与える」をクリック

---

## 4. 環境変数の設定

バックエンドを起動する前に以下の環境変数を設定してください。

### 4.1 Microsoft 365 必須設定

```bash
# Azure AD テナント ID（Azure Portal の概要から取得）
export M365_TENANT_ID="12345678-1234-1234-1234-123456789012"

# Azure AD アプリのクライアント ID
export M365_CLIENT_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Azure AD アプリのクライアントシークレット
export M365_CLIENT_SECRET="your-client-secret-value"

# OAuth リダイレクト URI（フロントエンドログイン用）
export OAUTH_REDIRECT_URI="http://localhost:8080/auth/callback"

# Microsoft 365 認証モード
export M365_AUTH_MODE="entra_id"
```

### 4.2 JWT 認証設定

```bash
# JWT トークン署名用のシークレット（開発環境のデフォルト値で可、本番は強力なシークレットに変更）
export JWT_SECRET="your-jwt-secret-key-min-32-chars-recommended"
```

### 4.3 データベース設定

```bash
# PostgreSQL 接続 URL
export DATABASE_URL="postgres://user:password@localhost:5432/m365kg"

# Neo4j 接続 URI
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="neo4j-password"
```

### 4.4 LLM / Cloud AI プロバイダーの設定

M365 Knowledge Graph は3つのレイヤーでLLM機能を提供します：

1. **Cloud LLM プロバイダー** (service/src/provider) - Electron UI サービス用
2. **llm-svc (Rust gRPC サービス)** - Go バックエンド用、ONNX/GGUF/safetensors サポート
3. **Go バックエンド** - llm-svc との通信

#### 4.4.1 Cloud LLM プロバイダーの設定（service/src/provider ベース）

Electron UI サービスが使用する 5種類のビルトイン Cloud LLM プロバイダーの設定です。  
各プロバイダーは `runtime/src/provider-env.ts` で管理される環境変数名で認証されます。

**ビルトイン プロバイダーと環境変数：**

| プロバイダー | 環境変数 | モデル例 |
|---|---|---|
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini` |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-latest` |
| **Google (Gemini)** | `GOOGLE_API_KEY`<br>`GOOGLE_GENERATIVE_AI_API_KEY`<br>`GEMINI_API_KEY` | `gemini-1.5-pro` |
| **OpenRouter** | `OPENROUTER_API_KEY` | `anthropic/claude-3.5-sonnet` |
| **カスタム (OpenAI互換)** | ユーザー定義 envVar | ユーザー定義 |

**例：OpenAI 設定**

```bash
# OpenAI API key（UI サービスで使用）
export OPENAI_API_KEY="sk-..."
```

**例：Anthropic 設定**

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**例：カスタム OpenAI互換エンドポイント（SSRF 検証あり）**

```bash
# 環境変数名とエンドポイントをセット
export CUSTOM_OPENAI_API_KEY="your-key"
# UI の API 経由でエンドポイントを設定（`base_url` は SSRF ポリシーで検証）
# POST /v1/providers/endpoint
# { "id": "custom-openai-compat", "baseUrl": "https://your-api-endpoint/v1" }
```

#### 4.4.2 ローカルモデルの設定（ONNX / GGUF / safetensors）

Go バックエンド用の llm-svc は、クラウドだけでなくローカルモデルも実行できます。  
ローカルモデルの設定は **`app/llm-svc/models.yaml`** で行います。  
以下のコメント例を参考に、必要に応じてコメントアウトを解除してください：

**models.yaml 内の主要なエントリ：**

```yaml
# デフォルト: Cloud embedding model
- name: text-embedding-3-small
  kind: embedding
  format: cloud
  path: ""
  dims: 1536
  version: "1.0"
  is_default: true

# ローカル ONNX embedding モデル（有効にするにはコメント解除）
# - name: e5-small-v2
#   kind: embedding
#   format: onnx
#   path: /models/e5-small-v2/          # model.onnx + tokenizer.json が必須
#   dims: 384
#   version: "1.0"
#   is_default: false

# ローカル GGUF generative モデル（有効にするにはコメント解除）
# - name: mistral-7b-instruct-gguf
#   kind: generative
#   format: gguf
#   path: /models/mistral-7b-instruct/  # model.gguf + tokenizer.json/model が必須
#   dims: 0
#   version: "1.0"
#   is_default: false

# デフォルト: Cloud generation model
- name: gpt-4o-mini
  kind: generative
  format: cloud
  path: ""
  dims: 0
  version: "1.0"
  is_default: true
```

**ONNX モデルのディレクトリ構成（必須）:**

```
/models/e5-small-v2/
  ├── model.onnx         ← ONNX モデルファイル
  └── tokenizer.json     ← HuggingFace tokenizer
```

**GGUF モデルのディレクトリ構成（必須）:**

```
/models/mistral-7b-instruct/
  ├── model.gguf              ← 量子化モデル
  ├── tokenizer.json          ← HuggingFace tokenizer（推奨）
  └── tokenizer.model         ← SentencePiece tokenizer（代替）
```

#### 4.4.3 llm-svc (Rust gRPC サービス) の設定

Go バックエンドは **llm-svc** という独立した gRPC サービス経由でLLMにアクセスします。  
llm-svc は Cloud + ローカルモデルの両方をサポートします。

**環境変数（llm-svc が読む）:**

| 変数 | デフォルト | 説明 |
|---|---|---|
| `LLMSVC_ADDR` | `0.0.0.0:9090` | gRPC サーバーバインドアドレス |
| `NLP_MODE` | `1` | 処理モード（1=cloud_only/2=cloud+local/3=local_only） |
| `LLM_API_BASE_URL` | - | Cloud LLM エンドポイント（オプション） |
| `LLM_API_KEY` | - | Cloud LLM API キー（オプション） |
| `LLM_MODEL` | `gpt-4o-mini` | Cloud モデル名 |
| `BRAIN_LOCAL_PROVIDER` | `qwen3-8b-q4` | ローカルモデル ID（Mode 2/3 用） |

**デフォルト設定（Cloud のみ）:**

```bash
# llm-svc gRPC サーバー
export LLMSVC_ADDR="0.0.0.0:9090"

# Mode 1: Cloud LLM のみ（推奨：初期設定）
export NLP_MODE=1
export LLM_API_BASE_URL="https://api.openai.com/v1"
export LLM_API_KEY="sk-..."
export LLM_MODEL="gpt-4o-mini"
```

**Mode 2 設定（Cloud + ローカルプリプロセッシング）:**

```bash
export NLP_MODE=2
export LLM_API_BASE_URL="https://api.openai.com/v1"
export LLM_API_KEY="sk-..."
export LLM_MODEL="gpt-4o-mini"
export BRAIN_LOCAL_PROVIDER="qwen3-8b-q4"
export BRAIN_FALLBACK_TO_CLOUD=true
```

**Mode 3 設定（ローカルのみ、オフライン環境）:**

```bash
export NLP_MODE=3
export BRAIN_LOCAL_PROVIDER="mistral-7b-instruct-gguf"
# Cloud 環境変数は不要
```

#### 4.4.4 Go バックエンドから llm-svc への接続

Go バックエンド（`app/backend/cmd/main.go`）は以下の環境変数で llm-svc に接続します：

```bash
# llm-svc の gRPC アドレス
export LLMSVC_ADDR="localhost:9090"

# TLS 有効化（本番環境推奨）
export LLMSVC_TLS="true"
export LLMSVC_CERT_FILE="/path/to/cert.pem"
```

**llm-svc の起動例（Docker）:**

```bash
docker run -it --rm \
  -p 9090:9090 \
  -e LLMSVC_ADDR="0.0.0.0:9090" \
  -e NLP_MODE=1 \
  -e LLM_API_BASE_URL="https://api.openai.com/v1" \
  -e LLM_API_KEY="sk-..." \
  -e LLM_MODEL="gpt-4o-mini" \
  -v /models:/models \
  llm-svc:latest
```

#### 4.4.5 NLP_MODE の選択ガイド

| Mode | 用途 | 特徴 |
|---|---|---|
| **1 (cloud_only)** | 通常の運用・本番環境 | すべての処理をクラウド LLM にプロキシ、安定性重視 |
| **2 (cloud+local)** | バランス型・コスト削減 | プリプロセッシングはローカル、複雑な処理はクラウド |
| **3 (local_only)** | オフライン環境・エアギャップ | すべて GPU/CPU でローカル実行、インターネット不要 |


### 4.5 同期設定

```bash
# デルタ同期間隔（デフォルト: 5 分）
export DELTA_SYNC_INTERVAL="5m"

# サーバーバインドアドレスとポート
export HOST="0.0.0.0"
export PORT="8080"
```

---

## 5. Microsoft 365 経由での接続（クラウド設定）

### 5.1 OneDrive 接続の追加

1. **フロントエンドで「M365 接続」または API 経由で以下をリクエスト**

   ```bash
   curl -X POST http://localhost:8080/api/m365/connect \
     -H "Authorization: Bearer <your-jwt-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "type": "onedrive",
       "tenant_id": "<M365_TENANT_ID>",
       "drive_id": "<drive_id_optional>",
       "site_id": "<site_id_optional>"
     }'
   ```

2. **レスポンス例**
   ```json
   {
     "connection_id": 1,
     "type": "onedrive",
     "status": "active",
     "connected_at": "2026-07-14T23:25:00Z"
   }
   ```

3. **データベース内に登録される**
   - `m365_connections` テーブルに新規レコード作成
   - `status = 'active'` で自動同期対象に

### 5.2 Teams 接続の追加

```bash
curl -X POST http://localhost:8080/api/m365/connect \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "teams",
    "tenant_id": "<M365_TENANT_ID>"
  }'
```

### 5.3 手動同期の実行

```bash
curl -X POST http://localhost:8080/api/m365/sync \
  -H "Authorization: Bearer <your-jwt-token>"
```

### 5.4 同期ステータスの確認

```bash
curl -X GET http://localhost:8080/api/m365/sync/status \
  -H "Authorization: Bearer <your-jwt-token>"
```

**レスポンス例**
```json
{
  "last_sync_at": "2026-07-14T23:30:00Z",
  "files_synced": 1250,
  "status": "completed"
}
```

---

## 6. M365 設定ができない場合の代替方法

### 6.1 方法A：OneDrive の drive_id を直接指定する方法

#### drive_id の取得方法

**A. MS Graph Explorer を使用**
1. [https://developer.microsoft.com/ja-jp/graph/graph-explorer](https://developer.microsoft.com/ja-jp/graph/graph-explorer) にアクセス
2. 以下のリクエストを実行
   ```
   GET /drives
   または
   GET /me/drive
   ```
3. レスポンスの `id` フィールドをコピー

**B. SharePoint サイトから取得**
1. SharePoint サイト URL: `https://contoso.sharepoint.com/sites/mysite`
2. MS Graph Explorer で実行
   ```
   GET /sites/contoso.sharepoint.com:/sites/mysite
   ```
3. `id` フィールドより site_id を取得し、さらに
   ```
   GET /sites/{siteId}/drive
   ```
   を実行して `drive_id` を取得

**C. 個人 OneDrive から取得**
```
GET /me/drive
```
レスポンスの `id` が `drive_id`

#### API 経由での接続設定

```bash
curl -X POST http://localhost:8080/api/m365/connect \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "onedrive",
    "tenant_id": "<M365_TENANT_ID>",
    "config": {
      "drive_id": "b!PkN3g4gK0U2wW5xZ-y8vQ9r0sT1uV2wX"
    }
  }'
```

#### 利点と制限事項
- ✅ 特定フォルダの直接指定が可能
- ✅ 基本的な同期機能は利用可能
- ❌ 権限フィルタリングは使用不可（全ユーザーが同じファイルにアクセス可能）
- ❌ リアルタイム同期ではなく DELTA_SYNC_INTERVAL のスケジュール依存

---

### 6.2 方法B：ローカル OneDrive フォルダを利用する方法

#### 適用シナリオ
- Microsoft 365 テナント接続ができない
- インターネット接続がない（オフライン環境）
- 開発・テスト環境での動作確認

#### Windows PC でのセットアップ

1. **OneDrive クライアントをインストール・サインイン**
   - Windows 10/11 の場合、プリインストール済み
   - スタートメニューから「OneDrive」を起動
   - Microsoft アカウントまたは職場アカウントでサインイン

2. **ローカル同期フォルダのパスを確認**
   ```
   個人アカウント：
   C:\Users\<ユーザー名>\OneDrive
   
   職場アカウント：
   C:\Users\<ユーザー名>\OneDrive - <組織名>
   ```

3. **ローカルフォルダのパスを環境変数に設定**（オプション）
   ```bash
   export LOCAL_ONEDRIVE_PATH="C:\Users\username\OneDrive"
   ```

#### Docker コンテナから参照する方法

**docker-compose.yml の例**
```yaml
services:
  backend:
    image: m365-knowledge-graph-backend
    volumes:
      # Windows ホストのローカル OneDrive を Docker にマウント
      - "C:\\Users\\username\\OneDrive:/app/data/onedrive:ro"
    environment:
      # ファイルシステムパスを指定
      LOCAL_ONEDRIVE_PATH: "/app/data/onedrive"
```

**WSL (Windows Subsystem for Linux) からの参照**
```bash
# Windows ホストのパスは /mnt/ 経由でアクセス
export LOCAL_ONEDRIVE_PATH="/mnt/c/Users/username/OneDrive"
```

#### ローカル OneDrive を使う際の制限事項

| 項目 | 説明 |
|---|---|
| **同期タイミング** | OneDrive クライアントの同期タイミングに依存（リアルタイム同期ではない） |
| **権限フィルタリング** | 使用不可（ローカルファイルシステムのため） |
| **複数ユーザーアクセス** | 制限あり（ローカル PC の 1 ユーザー分のみ） |
| **Teams 連携** | 非対応（OneDrive のみ） |
| **本番環境での推奨度** | 低（開発・テストのみ） |

#### ローカル OneDrive で同期を開始する手順

1. **バックエンド設定ファイルで local_path を指定**
   ```go
   // internal/connectors/onedrive.go 相当で実装
   const localOneDrivePath = "/app/data/onedrive"
   ```

2. **バックエンドを起動**
   ```bash
   go run ./cmd/main.go
   ```

3. **ログから同期状況を確認**
   ```
   INFO: delta sync scheduler started, interval=5m
   INFO: scheduled delta sync: connection synced, connection_id=1, type=onedrive
   ```

4. **デルタ同期は自動実行**
   - デフォルト 5 分間隔で実行
   - `/api/m365/sync/status` で状態確認可能

---

## 7. デルタ同期の仕組み

### 7.1 自動デルタ同期スケジューラ

バックエンド起動時に自動で以下が実行されます：

```go
// cmd/main.go より
deltaSyncScheduler := scheduler.NewDeltaSyncScheduler(cfg.DeltaSyncInterval)
deltaSyncScheduler.Start(schedulerCtx, func(ctx context.Context) error {
    return runScheduledDeltaSync(ctx, m365Deps, permissionExtractor, logger)
})
```

**処理フロー**
1. `m365_connections` テーブルから `status = 'active'` の接続を取得
2. 各接続ごとに OneDrive/Teams API を呼び出し
3. 差分ファイルを取得（deltaLink 使用）
4. `m365_files` テーブルに反映
5. `permission_cache` を更新

### 7.2 変更トークン（deltaLink）の管理

- **保存場所**: `delta_state` テーブルの `change_token` カラム
- **用途**: 前回以降の変更のみを差分取得
- **リセット**: `change_token` を NULL に設定すると次回フル同期

**手動リセット例**
```sql
UPDATE delta_state 
SET change_token = NULL 
WHERE source = 'onedrive:1';
```

### 7.3 同期間隔の変更

```bash
# デフォルト: 5 分 → 15 分に変更
export DELTA_SYNC_INTERVAL="15m"

# または秒単位
export DELTA_SYNC_INTERVAL="900s"
```

---

## 8. 権限フィルタリング

### 8.1 パーミッションキャッシュの仕組み

デルタ同期時に MS Graph API 経由で各ファイルの ACL を取得し `permission_cache` テーブルに保存：

```sql
-- permission_cache テーブル構造
CREATE TABLE permission_cache (
    user_id TEXT,
    file_id INT,
    permission VARCHAR(10),  -- 'owner' | 'write' | 'read'
    last_sync_at TIMESTAMP,
    PRIMARY KEY (user_id, file_id)
);
```

### 8.2 権限レベル（owner / write / read）

MS Graph の role から以下にマッピング：

| MS Graph Role | マッピング先 | 説明 |
|---|---|---|
| `owner` | `owner` | ファイル所有者 |
| `write`, `edit` | `write` | 編集権限 |
| `read` | `read` | 読み取り専用 |
| 不明 | `read` | デフォルト（読み取り） |

**クエリ時のフィルタリング**
```go
// retrieval/permission_filter.go
permissionFilter.ApplyPermissionFilter(userID, entities)
// → 該当ユーザーがアクセス可能なファイルのみ返す
```

---

## 9. 開発環境向けのフォールバック設定

### 9.1 DEV_LOGIN_USERNAME / DEV_LOGIN_PASSWORD の利用

M365 接続をスキップしてユーザー名・パスワード認証でテスト：

```bash
export DEV_LOGIN_USERNAME="testuser@example.com"
export DEV_LOGIN_PASSWORD="testpass123"
```

**ログイン API**
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser@example.com",
    "password": "testpass123"
  }'
```

**レスポンス例**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "testuser@example.com",
    "email": "testuser@example.com",
    "name": "Test User"
  }
}
```

⚠️ **本番環境での利用は禁止** - セキュリティリスク

---

## 10. トラブルシューティング

### 10.1 よくあるエラーと対処法

#### エラー: `failed to load config: M365_TENANT_ID is empty`

**原因**: 環境変数が未設定

**対処法**
```bash
echo $M365_TENANT_ID  # 空の場合は設定されていない
export M365_TENANT_ID="your-tenant-id"
```

---

#### エラー: `entra_id.ExchangeCode: status 401`

**原因**: クライアント ID またはシークレットが不正

**対処法**
1. Azure Portal で アプリ登録 → クライアント ID 確認
2. 「証明書とシークレット」 → シークレット値を再確認
3. 新しいシークレットを生成し、環境変数を更新

---

#### エラー: `onedrive.GetDelta: status 404`

**原因**: drive_id が存在しない、または削除されている

**対処法**
1. MS Graph Explorer で drive_id を再確認
2. 正しい drive_id で接続を再作成
   ```bash
   curl -X POST http://localhost:8080/api/m365/connect \
     -d '{"type":"onedrive","config":{"drive_id":"correct_drive_id"}}'
   ```

---

#### エラー: `failed to get token: M365_CLIENT_ID/M365_CLIENT_SECRET not configured`

**原因**: バックグラウンド同期時の認証情報不足

**対処法**
1. すべての M365 関連環境変数が設定されているか確認
   ```bash
   env | grep M365
   ```
2. 設定がされていなければ再度設定して再起動

---

#### エラー: `scheduled delta sync: connection failed ... permission denied`

**原因**: ローカル OneDrive フォルダへのアクセス権限がない

**対処法**
1. Docker 実行ユーザー、または WSL ユーザーがフォルダを読み取れるか確認
2. フォルダのパーミッション確認
   ```bash
   ls -la "/mnt/c/Users/username/OneDrive"
   ```
3. 必要に応じてパーミッション変更
   ```bash
   chmod -R 755 /path/to/onedrive
   ```

---

### 10.2 ログの確認方法

#### バックエンドログ確認

**Docker コンテナの場合**
```bash
docker logs <container_name> -f
```

**ローカル実行の場合**
```bash
go run ./cmd/main.go 2>&1 | tee backend.log
```

#### 特定のモジュールのみフィルタ

```bash
# 同期関連のログ
docker logs <container_name> | grep -i "delta"

# エラーログ
docker logs <container_name> | grep -i "error"

# 認証関連
docker logs <container_name> | grep -i "auth"
```

#### PostgreSQL ログで同期状態確認

```sql
-- 最後の同期実行時刻
SELECT source, change_token, last_sync_at 
FROM delta_state 
ORDER BY last_sync_at DESC;

-- 取得されたファイル数
SELECT COUNT(*) FROM m365_files WHERE source_type = 'onedrive';

-- 権限キャッシュ
SELECT COUNT(DISTINCT user_id) FROM permission_cache;
```

---

## 参考資料

- [Microsoft Graph API ドキュメント](https://docs.microsoft.com/ja-jp/graph/overview)
- [Azure AD アプリ登録ガイド](https://docs.microsoft.com/ja-jp/azure/active-directory/develop/quickstart-register-app)
- [OneDrive API リファレンス](https://docs.microsoft.com/ja-jp/onedrive/developer/rest-api/)
- [Teams API リファレンス](https://docs.microsoft.com/ja-jp/graph/api/resources/teams-api-overview)

---

**作成日**: 2026-07-14  
**バージョン**: 1.0  
**対応バージョン**: m365-knowledge-graph v1.0+
