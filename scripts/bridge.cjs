// Voice bridge helper — check for pending requests or write a response
// Usage:
//   node bridge.cjs poll [--wait <seconds>]  — returns oldest pending request, optionally blocking
//   node bridge.cjs reply <id> <text>        — write response for request id
//   node bridge.cjs status                   — show all pending requests
const fs = require("fs");
const path = require("path");
const BRIDGE = "/home/node/.openclaw/workspace/skills/phone-call/bridge";
fs.mkdirSync(BRIDGE, { recursive: true });

const cmd = process.argv[2];

function getRequest() {
  const files = fs.readdirSync(BRIDGE).filter(f => f.startsWith("request_")).sort();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(BRIDGE, files[0]), "utf-8"));
}

if (cmd === "poll") {
  const waitIdx = process.argv.indexOf("--wait");
  const waitSec = waitIdx !== -1 ? parseInt(process.argv[waitIdx + 1]) || 30 : 0;

  const req = getRequest();
  if (req) { console.log(JSON.stringify(req)); process.exit(0); }
  if (!waitSec) { console.log("none"); process.exit(0); }

  // Blocking wait — check every 500ms
  const deadline = Date.now() + waitSec * 1000;
  const iv = setInterval(() => {
    const r = getRequest();
    if (r) { clearInterval(iv); console.log(JSON.stringify(r)); process.exit(0); }
    if (Date.now() > deadline) { clearInterval(iv); console.log("none"); process.exit(0); }
  }, 500);

} else if (cmd === "reply") {
  const id = process.argv[3];
  const text = process.argv.slice(4).join(" ");
  if (!id || !text) { console.error("Usage: node bridge.cjs reply <id> <text>"); process.exit(1); }
  fs.writeFileSync(path.join(BRIDGE, `response_${id}.json`), JSON.stringify({ text }));
  const reqFile = path.join(BRIDGE, `request_${id}.json`);
  if (fs.existsSync(reqFile)) fs.unlinkSync(reqFile);
  console.log("ok");
} else if (cmd === "status") {
  const files = fs.readdirSync(BRIDGE).filter(f => f.startsWith("request_"));
  if (files.length === 0) { console.log("No pending requests"); process.exit(0); }
  for (const f of files) {
    const req = JSON.parse(fs.readFileSync(path.join(BRIDGE, f), "utf-8"));
    console.log(`[${req.id}] ${req.text}`);
  }
} else {
  console.error("Usage: node bridge.cjs poll [--wait <sec>] | reply <id> <text> | status");
  process.exit(1);
}
