---
name: phone-call
description: "AI 電話助理：透過 Twilio 撥打電話，以獨立角色 Iris（芊芊）與對方進行中文語音對話。使用場景：當用戶要求打電話、語音聯繫某人、電話詢問資訊、或需要 Iris 或芊芊出場時觸發。"
---

# Phone Call Skill

透過 Twilio 撥打電話，以 Iris（芊芊）角色執行語音對話任務。
芊芊由內建的輕量 LLM（Haiku）即時驅動對話，你負責啟動、制定策略、處理需要工具的請求。

## 角色

Iris 是獨立角色，對外自稱「主人的助理」。詳見 [references/iris-persona.md](references/iris-persona.md)。

## 打電話的完整流程

Cloudflare tunnel 和 port-forward 已常駐在 host（systemd），你不需要管。

### 1. 啟動 WS server（帶任務描述）

只需傳一個參數：任務描述（必填）。開場白已固定為「你好，我是主人的助理芊芊。」

⚠️ 參數是「任務描述」不是開場白！描述芊芊這通電話要達成什麼目標。

```bash
nohup node skills/phone-call/scripts/interactive_ws.cjs "<任務描述>" > /tmp/ws-server.log 2>&1 &
echo $!
```

範例：
```bash
nohup node skills/phone-call/scripts/interactive_ws.cjs "問對方明天早餐想吃什麼，語氣輕鬆自然" > /tmp/ws-server.log 2>&1 &
```

```bash
nohup node skills/phone-call/scripts/interactive_ws.cjs "確認對方的姓名和生日，用自然對話引導，不要直球提問" > /tmp/ws-server.log 2>&1 &
```
等 2 秒後確認：`cat /tmp/ws-server.log`，應看到 `[voice] Ready on port 3456`。

### 2. 撥號

```javascript
const twilio = require('/tmp/node_modules/twilio');
const client = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
});
const call = await client.calls.create({
  url: 'https://voice.example.com/voice',
  to: '<電話號碼，E.164 格式如 +886912345678>',
  from: process.env.TWILIO_FROM_NUMBER,
});
console.log('Call SID:', call.sid);
```

### 3. 監控工具請求

撥號後，芊芊會自動用 Haiku 即時對話。大部分情況你不需要介入。

但如果對方問了需要查資料的問題（天氣、新聞等），芊芊會寫 request 到 bridge：

```bash
node skills/phone-call/scripts/bridge.cjs poll --wait 30
```

- 回傳 `none` → 芊芊自己處理得了，不需要你
- 回傳 JSON → 裡面有 `tool_needed` 欄位和 `conversation` 對話歷史

收到 tool request 後：
1. 用你的工具查資料（web search 等）
2. 回覆結果：
```bash
node skills/phone-call/scripts/bridge.cjs reply <id> <查詢結果>
```

芊芊會把結果用口語化的方式告訴對方。

**持續 poll 直到通話結束。** 大部分 poll 會回傳 `none`，這是正常的。

### 4. 通話結束

通話結束後，對話紀錄會自動存在 `skills/phone-call/bridge/call_log.json`。

讀取並回報摘要給用戶：
```bash
cat skills/phone-call/bridge/call_log.json
```

然後清理：
```bash
pkill -f interactive_ws.cjs
rm skills/phone-call/bridge/call_log.json
```

## 對話策略

參考 [references/iris-persona.md](references/iris-persona.md)。
策略透過啟動時的「任務描述」參數傳給芊芊，她會自動遵循。

## 基礎設施

見 [references/infra.md](references/infra.md)。Twilio credentials 和 OpenAI TTS key 透過環境變數提供。

## 已知限制

- 中文短句語音辨識率偏低，名字容易誤判
- Twilio 按分鐘計費
- 需要工具的回應會比較慢（等你查資料）
