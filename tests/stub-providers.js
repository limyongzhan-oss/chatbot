// Local stand-in for Resend, Telegram and Meta WhatsApp APIs. Records every request so tests
// can check what dTBM would send. Not a mock of delivery — real delivery needs real keys.
//
//   node tests/stub-providers.js 4010
//   RESEND_API_BASE=http://127.0.0.1:4010 TELEGRAM_API_BASE=http://127.0.0.1:4010 \
//   WHATSAPP_API_BASE=http://127.0.0.1:4010 (plus fake keys) npm start
//
// Control endpoints: GET /__requests, POST /__reset, POST /__fail {"on":true},
// POST /__tg_start {"code":"abc","chat_id":12345} (queues a Telegram "/start abc" update).
const http = require("http");

const port = Number(process.argv[2] ?? 4010);
let requests = [];
let fail = false;
let updates = [];

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__requests") return json(res, 200, requests);
    if (url.pathname === "/__reset") { requests = []; fail = false; updates = []; return json(res, 200, {}); }
    if (url.pathname === "/__fail") { fail = !!body.on; return json(res, 200, { fail }); }
    if (url.pathname === "/__tg_start") {
      updates.push({ update_id: updates.length + 1, message: { text: `/start ${body.code}`, chat: { id: body.chat_id } } });
      return json(res, 200, {});
    }
    if (url.pathname.endsWith("/getUpdates")) return json(res, 200, { ok: true, result: updates });

    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, body });
    if (fail) return json(res, 500, { error: "stub failure" });
    if (url.pathname === "/emails") return json(res, 200, { id: "email_" + requests.length });
    if (url.pathname.endsWith("/sendMessage")) return json(res, 200, { ok: true, result: { message_id: requests.length } });
    if (url.pathname.endsWith("/messages")) return json(res, 200, { messages: [{ id: "wamid." + requests.length }] });
    json(res, 404, { error: "unknown path" });
  });
}).listen(port, "127.0.0.1", () => console.log(`stub providers on :${port}`));
