# Phone Call Skill for OpenClaw

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

## 授權

MIT
