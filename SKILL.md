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

### 3. 等待通話結束
撥號後，持續檢查 server 是否還在跑。通話結束 server 會自動退出：
```bash
while pgrep -f interactive_ws.cjs > /dev/null; do sleep 10; done
```
同時可以 poll bridge 處理工具請求：
```bash
node skills/phone-call/scripts/bridge.cjs poll --wait 30
```
收到 JSON 就查資料，然後 `bridge.cjs reply <id> <結果>`。

### 4. 回報結果
server 退出後，讀取對話紀錄並主動回報給用戶：
```bash
cat skills/phone-call/bridge/call_log.json
```
整理成摘要告訴用戶通話結果。

⚠️ 一次任務只打一通電話。通話結束就回報結果，不要自動重撥。
