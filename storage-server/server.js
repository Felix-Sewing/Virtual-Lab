const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3003;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const SCENES_DIR = path.join(DATA_DIR, "scenes");
const FILES_DIR = path.join(DATA_DIR, "files");
const LIBRARIES_DIR = path.join(DATA_DIR, "libraries");

fs.mkdirSync(SCENES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(LIBRARIES_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Scene: { sceneVersion, iv, ciphertext } stored as JSON with base64 binary fields

app.get("/scenes/:roomId", (req, res) => {
  try {
    const file = path.join(SCENES_DIR, `${req.params.roomId}.json`);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: "not found" });
    }
    res.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    console.error("GET /scenes failed:", err);
    res.status(500).json({ error: "read failed" });
  }
});

app.put("/scenes/:roomId", (req, res) => {
  try {
    const { sceneVersion, iv, ciphertext } = req.body;
    if (!iv || !ciphertext || sceneVersion == null) {
      return res.status(400).json({ error: "missing fields" });
    }
    const file = path.join(SCENES_DIR, `${req.params.roomId}.json`);
    fs.writeFileSync(file, JSON.stringify({ sceneVersion, iv, ciphertext }));
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /scenes failed:", err);
    res.status(500).json({ error: "write failed" });
  }
});

// Library: { iv, ciphertext } stored as JSON with base64 binary fields

app.get("/library/:roomId", (req, res) => {
  try {
    const file = path.join(LIBRARIES_DIR, `${req.params.roomId}.json`);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: "not found" });
    }
    res.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    console.error("GET /library failed:", err);
    res.status(500).json({ error: "read failed" });
  }
});

app.put("/library/:roomId", (req, res) => {
  try {
    const { iv, ciphertext } = req.body;
    if (!iv || !ciphertext) {
      return res.status(400).json({ error: "missing fields" });
    }
    const file = path.join(LIBRARIES_DIR, `${req.params.roomId}.json`);
    fs.writeFileSync(file, JSON.stringify({ iv, ciphertext }));
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /library failed:", err);
    res.status(500).json({ error: "write failed" });
  }
});

// Files: raw binary stored under data/files/<prefix>/<id>
// The full path comes from the URL: /files/<prefix>/<id>

app.get("/files/*", (req, res) => {
  try {
    const filePath = path.join(FILES_DIR, req.params[0]);
    if (!fs.existsSync(filePath)) {
      return res.status(404).end();
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", `public, max-age=${60 * 60 * 24 * 365}`);
    res.send(fs.readFileSync(filePath));
  } catch (err) {
    console.error("GET /files failed:", err);
    res.status(500).end();
  }
});

app.put("/files/*", (req, res) => {
  const filePath = path.join(FILES_DIR, req.params[0]);
  const chunks = [];

  req.on("data", (chunk) => chunks.push(chunk));
  req.on("error", (err) => {
    console.error("PUT /files request stream error:", err);
    res.status(500).json({ error: "upload failed" });
  });
  req.on("end", () => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.concat(chunks));
      res.json({ ok: true });
    } catch (err) {
      // e.g. EACCES (wrong ownership) or ENOSPC (disk full) — respond 500
      // instead of letting the exception crash the whole process.
      console.error("PUT /files write failed:", err);
      res.status(500).json({ error: "write failed" });
    }
  });
});

// last-resort guard so an unexpected error in any handler can't take the
// whole server down (which would 502 every subsequent request)
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "internal error" });
  }
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server kept alive):", err);
});

app.listen(PORT, () => {
  console.log(`Excalidraw storage server running on port ${PORT}`);
  console.log(`Data stored in: ${DATA_DIR}`);
});
