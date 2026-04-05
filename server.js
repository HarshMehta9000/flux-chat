// server.js — Local proxy server
// Users supply their own Anthropic API key via x-user-key header.
// The key is stored in their browser's localStorage only — never on this server.
// Run: node server.js

import "dotenv/config";
import express from "express";
import cors    from "cors";
import fetch   from "node-fetch";

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  // Use user-supplied key from header, fall back to server .env key if set
  const apiKey = req.headers["x-user-key"] || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(401).json({
      error: { message: "No API key provided. Add your Anthropic key in the app settings." }
    });
  }

  if (!apiKey.startsWith("sk-ant-")) {
    return res.status(401).json({
      error: { message: "Invalid API key format. Key must start with sk-ant-" }
    });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...req.body, stream: true }),
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      return res.status(upstream.status).json(err);
    }

    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");

    upstream.body.pipe(res);
    req.on("close", () => upstream.body.destroy());

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message } });
  }
});

app.listen(PORT, () =>
  console.log(`✔  FLUX proxy running → http://localhost:${PORT}`)
);
