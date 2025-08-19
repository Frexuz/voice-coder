import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// proxy POST /api/prompt -> backend
app.post("/api/prompt", express.json(), async (req, res) => {
  const backend = process.env.BACKEND_URL || "http://localhost:4000";
  try {
    // Node 18+ has global fetch; use it.
    const r = await fetch(backend + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const j = await r.json();
    res.json(j);
  } catch (err) {
    console.error("proxy error", err?.message || err);
    res.status(502).json({ error: "bad gateway" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`frontend listening on http://localhost:${PORT}`);
});
