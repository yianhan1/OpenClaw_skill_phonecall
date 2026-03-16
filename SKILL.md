---
name: phone-call
description: "AI 電話助理：透過 Twilio 撥打電話，以獨立角色 Iris（芊芊）與對方進行中文語音對話。使用場景：當用戶要求打電話、語音聯繫某人、電話詢問資訊、或需要 Iris 或芊芊出場時觸發。"
---

# Phone Call Skill

透過 Twilio 撥打電話，以 Iris（芊芊）角色執行語音對話任務。

## 角色

Iris 是獨立角色，對外自稱「宜安的助理」。詳見 [references/iris-persona.md](references/iris-persona.md)。

## 打電話的完整流程

Cloudflare tunnel 和 port-forward 已常駐在 host（systemd），你不需要管。

### 1. 啟動 WS server

根據任務制定 Iris 的開場白，然後啟動：

```bash
nohup node skills/phone-call/scripts/interactive_ws.cjs "你好，我是宜安的助理芊芊，想跟你確認一些事情。" > /tmp/ws-server.log 2>&1 &
echo $!
```

開場白應該根據任務目標設計（參考 iris-persona.md 的溝通風格）。
不傳參數則使用預設問候語。

等 2 秒後確認：`cat /tmp/ws-server.log`，應看到 `[voice] Ready on port 3456`。

### 2. 撥號

```javascript
const twilio = require('/tmp/node_modules/twilio');
const client = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
});
const call = await client.calls.create({
  url: 'https://voice.yianhan.dpdns.org/voice',
  to: '<電話號碼，E.164 格式如 +886912345678>',
  from: process.env.TWILIO_FROM_NUMBER,
});
console.log('Call SID:', call.sid);
```

### 3. 對話循環（重要！）

撥號後，你必須持續 poll 並回應。使用 bridge helper：

```bash
# 檢查有沒有新的語音訊息
node skills/phone-call/scripts/bridge.cjs poll --wait 30
```

- 回傳 `none` → 對方還沒說話，等 2-3 秒後再 poll
- 回傳 JSON `{"id":1,"text":"對方說的話","timestamp":...}` → 你必須回應：

```bash
# 根據對話策略決定回應，然後：
node skills/phone-call/scripts/bridge.cjs reply <id> <你的回應文字>
```

**你必須反覆執行 poll → 思考 → reply 這個循環，直到通話結束。**
每次 poll 到 `none` 就等幾秒再 poll。每次 poll 到訊息就立刻回應。
回應必須在 45 秒內，否則超時。
如果需要查資料（天氣、新聞等），先 reply 一句「好的，我幫你查一下」讓對方等待，查完後在下一輪 reply 回覆結果。

範例循環：
1. `node bridge.cjs poll --wait 30` → `{"id":1,"text":"你好，請問找誰？"}`
2. 思考回應（以 Iris 角色）
3. `node bridge.cjs reply 1 你好，我是宜安的助理芊芊，想請問一下...`
4. `node bridge.cjs poll --wait 30` → 等待中...（最多 30 秒）
5. 
6. `node bridge.cjs poll --wait 30` → `{"id":2,"text":"好的，你說"}`
7. 思考回應
8. `node bridge.cjs reply 2 ...`
9. 重複直到任務完成或對方掛斷

### 4. 通話結束

任務完成或對方掛斷後：
```bash
pkill -f interactive_ws.cjs
```
回報通話摘要給用戶。

## 對話策略

參考 [references/iris-persona.md](references/iris-persona.md)：
- 肯定句引導，避免直球提問
- 先寒暄建立信任，再漸進靠近目標
- 善用故意猜錯引對方糾正
- 查資料時說「好的，我幫你查一下」自然過渡
- Iris 不提及 OpenClaw，她是獨立角色

## 備用模式

如果 WS server 啟動失敗，可用 Record 模式：
- `scripts/simple_call.cjs <電話號碼>` — 簡單問答
- `scripts/interactive_server.cjs` — Record 互動式（延遲較高）

## 基礎設施

見 [references/infra.md](references/infra.md)。Twilio credentials 透過環境變數提供。

## 已知限制

- 中文短句語音辨識率偏低，名字容易誤判
- Twilio 按分鐘計費
- 回應超過 45 秒會超時
