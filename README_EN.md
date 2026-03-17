# Phone Call Skill for OpenClaw

[中文版](README.md)

AI phone assistant: make outbound calls via Twilio with a customizable AI persona for real-time voice conversations.

## Features

- **Media Streams Real-time** (Recommended) — Twilio WebSocket, 3-5s latency, natural conversation
- **Record Interactive** — Fallback, 15-20s latency
- **Simple Message** — One-way notifications, fixed Q&A

## Architecture

```
OpenClaw command → Start WS server → Twilio dials out
  → Media Streams WebSocket (real-time audio)
  → mulaw → PCM → AWS Transcribe (streaming STT)
  → AI generates response → AWS Polly TTS → send audio back
  → Call ends → Report summary
```

## Requirements

- [OpenClaw](https://github.com/thepagent/openclaw) instance
- Twilio account (Account SID, API Key, API Secret, Phone Number)
- AWS account (Polly TTS + Transcribe STT)
- Public URL for Twilio to reach WebSocket server (Cloudflare Tunnel / ngrok / direct port)

## Setup

1. Clone into OpenClaw workspace:
   ```bash
   cd /path/to/openclaw/workspace/skills
   git clone https://github.com/<your-username>/<your-repo>.git phone-call
   ```

2. Set environment variables (via helm values or pod env):
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_API_KEY=SK...
   TWILIO_API_SECRET=...
   TWILIO_FROM_NUMBER=+1...
   ```

3. Install Node.js dependencies:
   ```bash
   cd /tmp && npm install twilio @aws-sdk/client-polly @aws-sdk/client-transcribe-streaming ws
   ```

4. Configure your public URL and update the domain in `scripts/interactive_ws.cjs`.

## File Structure

```
SKILL.md                        # OpenClaw operation guide
scripts/
  interactive_ws.cjs            # Media Streams WebSocket server (recommended)
  interactive_server.cjs        # Record interactive (fallback)
  simple_call.cjs               # Simple message
  transcribe.cjs                # Audio transcription tool
references/
  iris-persona.md               # Phone persona example
  infra.md                      # Infrastructure docs
```

## 🚀 Pro Version

Looking for a more human-like calling experience?

👉 [phonecall_Pro](https://github.com/buddyxapp/phonecall_Pro) (Private — contact for access)

| | Free | Pro |
|--|------|-----|
| Real-time voice conversation | ✅ | ✅ Lower latency |
| Natural interruption handling | Basic | ✅ AI understands interrupted context |
| Voicemail detection | ❌ | ✅ Auto-detect and hang up |
| Bilingual (Chinese + English) | ❌ | ✅ |
| Smart call ending | ❌ | ✅ Detects goodbye intent, auto hang-up |
| No-answer handling | ❌ | ✅ Auto-detect and end call |
| Natural wait response | ❌ | ✅ Acknowledges thinking time, no dead air |
| Multi-segment understanding | ❌ | ✅ Merges fragmented speech for better replies |
| Live info lookup | ❌ | ✅ Real-time search during calls |
| Multi-model support | Single model | ✅ Switch between AI models |

## License

MIT
