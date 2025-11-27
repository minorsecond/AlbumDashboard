// server.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Paths / DB setup ----------
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "dashboard.db");

// Make sure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Open (or create) the SQLite database
const db = new Database(DB_PATH);

// Create table if it doesn't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS project_state (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )
`);

// ---------- Express app ----------
const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// GET /api/state -> return saved dashboard state (or null if none yet)
app.get("/api/state", (req, res) => {
    try {
        const row = db
            .prepare("SELECT data FROM project_state WHERE id = ?")
            .get("default");
        if (!row) {
            return res.json(null);
        }
        const parsed = JSON.parse(row.data);
        return res.json(parsed);
    } catch (err) {
        console.error("Error reading state from DB:", err);
        return res.status(500).json({ error: "Failed to read state" });
    }
});

// POST /api/state ->  overwrite saved dashboard state
app.post("/api/state", (req, res) => {
    try {
        const payload = req.body ?? {};
        const data = JSON.stringify(payload);

        db.prepare(
            `
      INSERT INTO project_state (id, data)
      VALUES ('default', ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `,
        ).run(data);

        return res.status(204).end();
    } catch (err) {
        console.error("Error writing state to DB:", err);
        return res.status(500).json({ error: "Failed to save state" });
    }
});

// Health check (optional)
app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
