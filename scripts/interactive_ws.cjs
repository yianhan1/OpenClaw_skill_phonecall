// Media Streams WebSocket server — real-time voice conversation
// Dual-LLM: Haiku for instant replies, OpenClaw (via bridge) for tool-dependent queries
const http = require("http");
const https = require("https");
const { WebSocketServer } = require("/tmp/node_modules/ws");
const { BedrockRuntimeClient, InvokeModelCommand } = require("/tmp/node_modules/@aws-sdk/client-bedrock-runtime");
const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = require("/tmp/node_modules/@aws-sdk/client-transcribe-streaming");
const fs = require("fs");
const path = require("path");

const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });
const INBOX = "/home/node/.openclaw/workspace/skills/phone-call/bridge";
const AUDIO_DIR = "/tmp/twilio_audio";
fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const PORT = 3456;
const GREETING = process.argv[2] || "你好，我是主人的助理芊芊。有什麼我可以幫你的嗎？";
const TASK = process.argv[3] || "";
const IDLE_TIMEOUT = 10 * 60 * 1000;
let lastActivity = Date.now();
let requestCounter = 0;

const SYSTEM_PROMPT = `你是 Iris（芊芊），主人的助理。你正在打電話。
角色：專業親切、知性俐落、高情商。用中文對話。
溝通風格：肯定句多於疑問句，善用猜測引導對方回應，先寒暄再漸進靠近目標。
${TASK ? "本次任務：" + TASK : "沒有特定任務，就是自然聊天。不要自己編造任務或推銷任何東西。"}

重要規則：
- 回應要簡短口語，像真人講電話，不要長篇大論
- 一次只說 1-2 句話
- 不要提到 AI 或機器人
- 嚴格遵守任務描述，不要自己發明額外的目標
- 如果對方問的問題需要查資料（天氣、新聞、地址、營業時間等即時資訊），回覆格式必須是：
  [NEED_TOOL: 簡述需要查什麼]
  不要自己編造即時資訊`;

// mulaw <-> PCM conversion
const MULAW_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xff;
  let sign = mu & 0x80 ? -1 : 1;
  let exponent = (mu >> 4) & 0x07;
  let mantissa = mu & 0x0f;
  MULAW_TABLE[i] = sign * (((mantissa << 1) + 33) << (exponent + 2)) - sign * 132;
}

function mulawToPcm(buf) {
  const pcm = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(MULAW_TABLE[buf[i]], i * 2);
  return pcm;
}

function pcmToMulaw(pcmBuf) {
  const out = Buffer.alloc(pcmBuf.length / 2);
  for (let i = 0; i < out.length; i++) {
    let s = pcmBuf.readInt16LE(i * 2);
    let sign = s < 0 ? 0x80 : 0;
    if (s < 0) s = -s;
    if (s > 32635) s = 32635;
    s += 0x84;
    let exp = 7;
    for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
    out[i] = ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
  }
  return out;
}

async function tts(text) {
  const body = JSON.stringify({ model: "tts-1", input: text, voice: "shimmer", response_format: "pcm" });
  const buf = await new Promise((resolve, reject) => {
    const req = https.request("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_TTS_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`TTS ${res.statusCode}`)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
  // 24kHz -> 8kHz downsample
  const samples8 = Math.floor(buf.length / 2 / 3);
  const pcm8 = Buffer.alloc(samples8 * 2);
  for (let i = 0; i < samples8; i++) pcm8.writeInt16LE(buf.readInt16LE(i * 6), i * 2);
  return pcmToMulaw(pcm8);
}

function sendAudio(ws, streamSid, mulaw) {
  const sz = 160;
  for (let i = 0; i < mulaw.length; i += sz) {
    ws.send(JSON.stringify({
      event: "media", streamSid,
      media: { payload: mulaw.slice(i, i + sz).toString("base64") },
    }));
  }
}

async function transcribe(pcmBuffer) {
  const client = new TranscribeStreamingClient({ region: "us-east-1" });
  const CHUNK = 4096;
  async function* stream() {
    for (let i = 0; i < pcmBuffer.length; i += CHUNK)
      yield { AudioEvent: { AudioChunk: pcmBuffer.slice(i, i + CHUNK) } };
  }
  const resp = await client.send(new StartStreamTranscriptionCommand({
    LanguageCode: "zh-TW", MediaEncoding: "pcm", MediaSampleRateHertz: 8000,
    AudioStream: stream(),
  }));
  let text = "";
  for await (const ev of resp.TranscriptResultStream) {
    if (ev.TranscriptEvent)
      for (const r of ev.TranscriptEvent.Transcript.Results)
        if (!r.IsPartial && r.Alternatives?.length) text += r.Alternatives[0].Transcript;
  }
  return text;
}

// Haiku for instant conversation
async function askHaiku(history) {
  const r = await bedrock.send(new InvokeModelCommand({
    modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    contentType: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: history,
    }),
  }));
  return JSON.parse(new TextDecoder().decode(r.body)).content[0].text;
}

function waitForResponse(id, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const f = path.join(INBOX, `response_${id}.json`);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fs.existsSync(f)) {
        clearInterval(iv);
        const d = JSON.parse(fs.readFileSync(f, "utf-8"));
        fs.unlinkSync(f);
        resolve(d.text);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(iv);
        reject(new Error("timeout"));
      }
    }, 500);
  });
}

// HTTP + WebSocket server
const httpServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/voice") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      lastActivity = Date.now();
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Connect><Stream url="wss://voice.example.com/stream" /></Connect></Response>`);
    });
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: "/stream" });

wss.on("connection", (ws) => {
  console.log("[ws] Media Stream connected");
  lastActivity = Date.now();

  let streamSid = null;
  let audioChunks = [];
  let silenceFrames = 0;
  let speaking = false;
  let processing = false;
  let greeted = false;
  const history = []; // conversation history for Haiku

  ws.on("message", async (data) => {
    const msg = JSON.parse(data);

    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      console.log(`[ws] Stream: ${streamSid}, Call: ${msg.start.callSid}`);
      if (!greeted) {
        greeted = true;
        try {
          const audio = await tts(GREETING);
          sendAudio(ws, streamSid, audio);
          history.push({ role: "assistant", content: GREETING });
        } catch (e) { console.error("[ws] greeting error:", e.message); }
      }
    }

    if (msg.event === "media" && !processing) {
      lastActivity = Date.now();
      const pcm = mulawToPcm(Buffer.from(msg.media.payload, "base64"));

      let energy = 0;
      for (let i = 0; i < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
      energy /= (pcm.length / 2);

      if (energy > 500) {
        speaking = true;
        silenceFrames = 0;
        audioChunks.push(pcm);
      } else if (speaking) {
        audioChunks.push(pcm);
        if (++silenceFrames > 30) {
          speaking = false;
          silenceFrames = 0;
          const fullPcm = Buffer.concat(audioChunks);
          audioChunks = [];
          if (fullPcm.length > 3200) {
            processing = true;
            try {
              const text = await transcribe(fullPcm);
              if (text.trim()) {
                console.log(`[ws] User: ${text}`);
                history.push({ role: "user", content: text });

                // Ask Haiku for instant reply
                const t0 = Date.now();
                const reply = await askHaiku(history);
                console.log(`[ws] Haiku (${Date.now() - t0}ms): ${reply}`);

                // Check if Haiku needs tools
                const toolMatch = reply.match(/\[NEED_TOOL:\s*(.+?)\]/);
                if (toolMatch) {
                  // Play filler while OpenClaw handles it
                  const filler = "好的，我幫你查一下。";
                  history.push({ role: "assistant", content: filler });
                  sendAudio(ws, streamSid, await tts(filler));

                  // Send to OpenClaw via bridge with full context
                  const id = ++requestCounter;
                  fs.writeFileSync(path.join(INBOX, `request_${id}.json`),
                    JSON.stringify({
                      id, text, timestamp: Date.now(),
                      tool_needed: toolMatch[1],
                      conversation: history,
                    }));
                  console.log(`[ws] → OpenClaw: ${toolMatch[1]}`);

                  const toolReply = await waitForResponse(id);
                  console.log(`[ws] ← OpenClaw: ${toolReply}`);

                  // Feed OpenClaw's answer back to Haiku for natural delivery
                  history.push({ role: "user", content: `[查詢結果: ${toolReply}] 請用口語化的方式把這個結果告訴對方` });
                  const naturalReply = await askHaiku(history);
                  history.push({ role: "assistant", content: naturalReply });
                  sendAudio(ws, streamSid, await tts(naturalReply));
                } else {
                  // Direct reply from Haiku
                  history.push({ role: "assistant", content: reply });
                  sendAudio(ws, streamSid, await tts(reply));
                }
              }
            } catch (e) {
              console.error("[ws] error:", e.message);
              try { sendAudio(ws, streamSid, await tts("抱歉，我遇到了一點問題。請再說一次。")); } catch {}
            }
            processing = false;
          }
        }
      }
    }

    if (msg.event === "stop") {
      console.log("[ws] Stream stopped");
      // Save conversation log for OpenClaw to report
      const logFile = path.join(INBOX, "call_log.json");
      fs.writeFileSync(logFile, JSON.stringify({ history, endTime: Date.now() }, null, 2));
      ws.close();
    }
  });

  ws.on("close", () => console.log("[ws] Disconnected"));
});

httpServer.listen(PORT, () => {
  console.log(`[voice] Ready on port ${PORT}`);
  console.log(`[voice] Webhook: https://voice.example.com/voice`);
  console.log(`[voice] WS: wss://voice.example.com/stream`);
  if (TASK) console.log(`[voice] Task: ${TASK}`);
});

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT) {
    console.log("[voice] Idle timeout, exiting");
    process.exit(0);
  }
}, 30000);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
