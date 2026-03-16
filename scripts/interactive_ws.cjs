// Media Streams WebSocket server — real-time voice conversation
const http = require("http");
const { WebSocketServer } = require("/tmp/node_modules/ws");
const { PollyClient, SynthesizeSpeechCommand } = require("/tmp/node_modules/@aws-sdk/client-polly");
const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = require("/tmp/node_modules/@aws-sdk/client-transcribe-streaming");
const fs = require("fs");
const path = require("path");

const polly = new PollyClient({ region: "us-east-1" });
const INBOX = "/home/node/.openclaw/workspace/skills/phone-call/bridge";
const AUDIO_DIR = "/tmp/twilio_audio";
fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const PORT = 3456;
const GREETING = process.argv[2] || "你好，我是主人的助理芊芊。有什麼我可以幫你的嗎？";
const IDLE_TIMEOUT = 10 * 60 * 1000;
let lastActivity = Date.now();
let requestCounter = 0;

// mulaw -> 16-bit PCM lookup table
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
  const r = await polly.send(new SynthesizeSpeechCommand({
    Text: text, OutputFormat: "pcm", VoiceId: "Zhiyu", Engine: "neural",
    LanguageCode: "cmn-CN", SampleRate: "8000",
  }));
  const chunks = [];
  for await (const c of r.AudioStream) chunks.push(c);
  return pcmToMulaw(Buffer.concat(chunks));
}

function sendAudio(ws, streamSid, mulaw) {
  const sz = 160; // 20ms at 8kHz
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
        } catch (e) { console.error("[ws] greeting error:", e.message); }
      }
    }

    if (msg.event === "media" && !processing) {
      lastActivity = Date.now();
      const pcm = mulawToPcm(Buffer.from(msg.media.payload, "base64"));

      // Energy-based VAD
      let energy = 0;
      for (let i = 0; i < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
      energy /= (pcm.length / 2);

      if (energy > 500) {
        speaking = true;
        silenceFrames = 0;
        audioChunks.push(pcm);
      } else if (speaking) {
        audioChunks.push(pcm);
        if (++silenceFrames > 50) { // ~1s silence
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
                const id = ++requestCounter;
                fs.writeFileSync(path.join(INBOX, `request_${id}.json`),
                  JSON.stringify({ id, text, timestamp: Date.now() }));
                const reply = await waitForResponse(id);
                console.log(`[ws] Reply: ${reply}`);
                sendAudio(ws, streamSid, await tts(reply));
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
      ws.close();
    }
  });

  ws.on("close", () => console.log("[ws] Disconnected"));
});

httpServer.listen(PORT, () => {
  console.log(`[voice] Ready on port ${PORT}`);
  console.log(`[voice] Webhook: https://voice.example.com/voice`);
  console.log(`[voice] WS: wss://voice.example.com/stream`);
});

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT) {
    console.log("[voice] Idle timeout, exiting");
    process.exit(0);
  }
}, 30000);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
