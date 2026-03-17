# Phone Call Skill for OpenClaw

[English](README_EN.md)

AI 電話助理：透過 Twilio 撥打電話，以自訂角色進行中文語音對話。

## 功能

- **Media Streams 即時對話**（推薦）— Twilio WebSocket，延遲 3-5 秒，自然對話
- **Record 互動式** — 備用方案，延遲 15-20 秒
- **簡單留言式** — 單向通知、固定問答

## 架構

```
OpenClaw 下指令 → 啟動 WS server → Twilio 撥號
  → Media Streams WebSocket 即時音訊
  → mulaw → PCM → AWS Transcribe（即時轉文字）
  → OpenClaw 決定回應 → AWS Polly TTS → 回傳語音
  → 通話結束 → 回報摘要
```

## 需求

- [OpenClaw](https://github.com/thepagent/openclaw) 實例
- Twilio 帳號（Account SID, API Key, API Secret, 電話號碼）
- AWS 帳號（Polly TTS + Transcribe STT）
- 公開 URL 讓 Twilio 連到 WebSocket server（Cloudflare Tunnel / ngrok / 直接暴露 port）

## 安裝

1. Clone 到 OpenClaw workspace：
   ```bash
   cd /path/to/openclaw/workspace/skills
   git clone https://github.com/<your-username>/<your-repo>.git phone-call
   ```

2. 設定環境變數（透過 helm values 或 pod env）：
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_API_KEY=SK...
   TWILIO_API_SECRET=...
   TWILIO_FROM_NUMBER=+1...
   ```

3. 安裝 Node.js 依賴：
   ```bash
   cd /tmp && npm install twilio @aws-sdk/client-polly @aws-sdk/client-transcribe-streaming ws
   ```

4. 設定公開 URL 並更新 `scripts/interactive_ws.cjs` 中的域名。

## 檔案結構

```
SKILL.md                        # OpenClaw 操作指南
scripts/
  interactive_ws.cjs            # Media Streams WebSocket server（推薦）
  interactive_server.cjs        # Record 互動式（備用）
  simple_call.cjs               # 簡單留言式
  transcribe.cjs                # 錄音轉文字工具
references/
  iris-persona.md               # 電話角色設定範例
  infra.md                      # 基礎設施文件
```

## 🚀 Pro 版本

需要更接近真人的通話體驗？

👉 [phonecall_Pro](https://github.com/buddyxapp/phonecall_Pro)（Private — 聯繫取得存取權限）

| | 免費版 | Pro |
|--|--------|-----|
| 即時語音對話 | ✅ | ✅ 更低延遲 |
| 自然打斷對話 | 基本 | ✅ AI 理解被打斷的語境 |
| 語音信箱識別 | ❌ | ✅ 自動識別並結束通話 |
| 中英文混合對話 | ❌ | ✅ |
| 智慧結束對話 | ❌ | ✅ 判斷對方意願，適時收尾 |
| 無人接聽處理 | ❌ | ✅ 自動偵測並結束 |
| 通話結束自動掛斷 | ❌ | ✅ 道別後主動結束通話 |

## 授權

MIT
