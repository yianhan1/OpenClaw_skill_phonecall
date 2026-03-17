---
name: phone-call
description: "打電話給某人，讓芊芊執行語音對話任務"
---

# Phone Call

## 流程

### 1. 啟動
```bash
nohup node skills/phone-call/scripts/interactive_ws.cjs "<任務描述>" > /tmp/ws-server.log 2>&1 &
```
範例：`"問對方明早想吃什麼"`

### 2. 撥號
```javascript
const twilio = require('/tmp/node_modules/twilio');
const client = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, { accountSid: process.env.TWILIO_ACCOUNT_SID });
await client.calls.create({ url: 'https://voice.example.com/voice', to: '<+886...>', from: process.env.TWILIO_FROM_NUMBER });
```

### 3. 等待通話結束並回報
撥號後你必須等通話結束。執行以下指令，它會阻塞直到通話結束：
```bash
tail -f /tmp/ws-server.log | sed '/Call ended/q'
```
看到 "Call ended" 後，讀取對話紀錄：
```bash
cat skills/phone-call/bridge/call_log.json
```
整理成摘要，主動回報給用戶。

⚠️ 一次任務只打一通電話。通話結束就回報結果，不要自動重撥。
