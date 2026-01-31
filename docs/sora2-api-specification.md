# OpenAI Sora 2 API 仕様

## 1. 利用可能なモデル

| モデル | 説明 |
|--------|------|
| `sora-2` | 標準モデル（デフォルト） |
| `sora-2-pro` | 高品質モデル。レンダリング時間が長く高価だが、より安定した高精細な映像を生成。シネマティックな映像やマーケティング素材に最適 |

## 2. APIエンドポイント

| 操作 | エンドポイント |
|------|---------------|
| 動画生成 | `POST https://api.openai.com/v1/videos` |
| リミックス | `POST https://api.openai.com/v1/videos/{video_id}/remix` |
| 一覧取得 | `GET https://api.openai.com/v1/videos` |
| ステータス確認 | `GET https://api.openai.com/v1/videos/{video_id}` |
| ダウンロード | `GET https://api.openai.com/v1/videos/{video_id}/content` |

## 3. リクエストパラメータ

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `prompt` | string | 動画の内容を記述（被写体、カメラ、照明、動きなど） |
| `model` | string | `sora-2` または `sora-2-pro` |
| `size` | string | 解像度（例: `1280x720`, `720x1280`） |
| `seconds` | integer | 動画の長さ: **4, 8, 12秒** のいずれか（デフォルト: 4） |
| `input_reference` | file | Image-to-Video用の入力画像 |
| `remix_video_id` | string | リミックス元の動画ID |

## 4. サポートされる解像度

| アスペクト比 | 解像度例 |
|-------------|---------|
| 16:9（横長） | 1920x1080, 1280x720 |
| 9:16（縦長） | 1080x1920, 720x1280 |
| 1:1（正方形） | 1080x1080, 480x480 |

## 5. 入力ファイル形式

**Image-to-Video（input_reference）:**
- `image/jpeg`
- `image/png`
- `image/webp`
- ※画像の解像度は出力動画のサイズと一致させる必要あり

## 6. ジョブステータス

| ステータス | 説明 |
|-----------|------|
| `queued` | キュー待ち |
| `in_progress` / `running` | 処理中 |
| `completed` / `succeeded` | 完了 |
| `failed` | 失敗 |
| `cancelled` | キャンセル |

**推奨ポーリング間隔:** 10〜20秒、指数バックオフを推奨

## 7. サンプルコード

### curl
```bash
curl -X POST "https://api.openai.com/v1/videos" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F prompt="A cat playing piano in a jazz bar" \
  -F model="sora-2" \
  -F size="1280x720" \
  -F seconds="8"
```

### Python
```python
import requests
import time

api_key = "YOUR_API_KEY"
headers = {
    "Authorization": f"Bearer {api_key}",
}

# 1. 動画生成リクエスト
response = requests.post(
    "https://api.openai.com/v1/videos",
    headers=headers,
    data={
        "prompt": "A cat playing piano in a jazz bar",
        "model": "sora-2",
        "size": "1280x720",
        "seconds": 8
    }
)
video_id = response.json()["id"]

# 2. ステータス確認（ポーリング）
while True:
    status_res = requests.get(
        f"https://api.openai.com/v1/videos/{video_id}",
        headers=headers
    ).json()

    if status_res["status"] == "completed":
        break
    elif status_res["status"] == "failed":
        raise Exception("Video generation failed")
    time.sleep(15)

# 3. 動画ダウンロード
video_content = requests.get(
    f"https://api.openai.com/v1/videos/{video_id}/content",
    headers=headers
).content

with open("output.mp4", "wb") as f:
    f.write(video_content)
```

## 8. 特徴

- **音声同期**: Sora 2は動画と同期した音声も生成可能
- **リミックス機能**: 既存動画を新しいプロンプトで再生成
- **Image-to-Video**: 画像から動画を生成

## 参考リンク

- [Video generation with Sora | OpenAI](https://platform.openai.com/docs/guides/video-generation)
- [Videos API Reference | OpenAI](https://platform.openai.com/docs/api-reference/videos)
- [Sora video generation - Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/video-generation-quickstart)
