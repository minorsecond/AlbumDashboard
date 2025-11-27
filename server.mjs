// server.mjs — future-proof Album Dashboard API with history + bounded undo
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import express from "express";
import Database from "better-sqlite3";

const MAX_UNDO_HISTORY = 100;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Paths / DB setup ----------
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "dashboard.db");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// If you were previously using project_state JSON, it's safe to drop here.
db.exec(`
  DROP TABLE IF EXISTS project_state;
`);

// ---------- Schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS artists (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    artist_id  TEXT REFERENCES artists(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'album', -- album | ep | single | other
    status     TEXT NOT NULL DEFAULT 'active', -- active | archived
    target_iso TEXT,
    album_size INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    notes      TEXT
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    track_index INTEGER NOT NULL,
    title       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    notes       TEXT,
    UNIQUE(project_id, track_index)
  );

  CREATE TABLE IF NOT EXISTS track_stages (
    id          TEXT PRIMARY KEY,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    stage_index INTEGER NOT NULL,
    name        TEXT NOT NULL,
    value       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(track_id, stage_index)
  );

  -- History of saved snapshots, for future undo/time-travel UI
  CREATE TABLE IF NOT EXISTS project_history (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source      TEXT NOT NULL,   -- e.g. 'api-state', 'api-project'
    description TEXT,
    snapshot    TEXT NOT NULL    -- JSON snapshot of what the client sent
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Ensure album_size exists for older DBs that were created before this column
try {
    db.exec("ALTER TABLE projects ADD COLUMN album_size INTEGER");
} catch (e) {
    // ignore; column already exists
}

// Seed schema version
db.prepare(
    "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')"
).run();

const CURRENT_PROJECT_KEY = "current_project_id";

// How many history entries to keep per project (for undo / time travel)
const HISTORY_MAX_ENTRIES_PER_PROJECT = Number(
    process.env.HISTORY_MAX_ENTRIES_PER_PROJECT || MAX_UNDO_HISTORY
);

// ---------- Helpers ----------
function getOrCreateDefaultArtistId() {
    const existing = db
        .prepare("SELECT id FROM artists WHERE name = ?")
        .get("Default Artist");
    if (existing) return existing.id;

    const id = randomUUID();
    db.prepare("INSERT INTO artists (id, name) VALUES (?, ?)").run(
        id,
        "Default Artist"
    );
    return id;
}

function getCurrentProjectIdOrNull() {
    const row = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get(CURRENT_PROJECT_KEY);
    return row ? row.value : null;
}

function setCurrentProjectId(projectId) {
    db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"
    ).run(CURRENT_PROJECT_KEY, projectId);
}

function trimProjectHistory(projectId) {
    const maxEntries = HISTORY_MAX_ENTRIES_PER_PROJECT;

    if (!projectId || !Number.isFinite(maxEntries) || maxEntries <= 0) {
        return;
    }

    db.prepare(
        `
      DELETE FROM project_history
       WHERE project_id = ?
         AND id NOT IN (
           SELECT id
             FROM project_history
            WHERE project_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
         )
    `
    ).run(projectId, projectId, maxEntries);
}

// Log a snapshot into project_history (for future undo)
function logProjectHistory(projectId, snapshot, source, description) {
    if (!projectId) return;

    const json = JSON.stringify(snapshot ?? {});

    db.prepare(
        `
      INSERT INTO project_history (id, project_id, source, description, snapshot)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(
        randomUUID(),
        projectId,
        source || "api-state",
        description || null,
        json
    );

    // After inserting the new snapshot, trim to the last N entries
    trimProjectHistory(projectId);
}

function loadSnapshotForProject(projectId) {
    const project = db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(projectId);
    if (!project) return null;

    const tracks = db
        .prepare(
            "SELECT * FROM tracks WHERE project_id = ? ORDER BY track_index"
        )
        .all(projectId);

    if (!tracks.length) {
        return null;
    }

    const stageStmt = db.prepare(
        "SELECT * FROM track_stages WHERE track_id = ? ORDER BY stage_index"
    );

    const songs = tracks.map((t) => {
        const stages = stageStmt.all(t.id).map((s) => ({
            name: s.name,
            value: s.value
        }));
        return {
            id: t.track_index,
            title: t.title,
            stages,
            notes: t.notes || null
        };
    });

    const maxSongCount = songs.length || 0;
    let effectiveSongCount = maxSongCount;
    if (maxSongCount > 0) {
        const stored = Number(project.album_size);
        if (Number.isFinite(stored) && stored > 0) {
            effectiveSongCount = Math.min(maxSongCount, stored);
        }
    }

    return {
        albumTitle: project.title,
        targetISO: project.target_iso,
        songs,
        songCount: effectiveSongCount,
        notes: project.notes || null
    };
}

function loadCurrentSnapshot() {
    const projectId = getCurrentProjectIdOrNull();
    if (!projectId) return null;
    return loadSnapshotForProject(projectId);
}

// Transactional save + history log
const saveSnapshotTx = db.transaction(
    (projectId, snapshot, createIfMissing, source, description) => {
        const artistId = getOrCreateDefaultArtistId();

        const albumTitle =
            snapshot.albumTitle && String(snapshot.albumTitle).trim().length
                ? String(snapshot.albumTitle).trim()
                : "Album Dashboard";

        const albumNotes =
            snapshot.notes && String(snapshot.notes).trim().length
                ? String(snapshot.notes).trim()
                : null;

        const songs = Array.isArray(snapshot.songs) ? snapshot.songs : [];
        const targetISO = snapshot.targetISO || null;

        const maxSongCount = songs.length || 1;
        const rawSongCount = Number(snapshot.songCount);
        const albumSize =
            Number.isFinite(rawSongCount) && rawSongCount > 0
                ? Math.min(maxSongCount, rawSongCount)
                : maxSongCount;

        let pid = projectId;

        if (!pid) {
            if (!createIfMissing) {
                throw new Error("No project id provided and createIfMissing=false");
            }
            pid = randomUUID();
            db.prepare(
                `
          INSERT INTO projects (id, artist_id, title, type, status, target_iso, album_size, notes)
          VALUES (?, ?, ?, 'album', 'active', ?, ?, ?)
        `
            ).run(pid, artistId, albumTitle, targetISO, albumSize, albumNotes);
            setCurrentProjectId(pid);
        } else {
            db.prepare(
                `
          UPDATE projects
             SET title = ?,
                 target_iso = ?,
                 album_size = ?,
                 notes = ?,
                 updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE id = ?
        `
            ).run(albumTitle, targetISO, albumSize, albumNotes, pid);
        }

        const existingTrackIds = db
            .prepare("SELECT id FROM tracks WHERE project_id = ?")
            .all(pid)
            .map((r) => r.id);

        if (existingTrackIds.length > 0) {
            const placeholders = existingTrackIds.map(() => "?").join(",");
            db.prepare(
                `DELETE FROM track_stages WHERE track_id IN (${placeholders})`
            ).run(...existingTrackIds);
        }

        db.prepare("DELETE FROM tracks WHERE project_id = ?").run(pid);

        const insertTrack = db.prepare(
            `
        INSERT INTO tracks (id, project_id, track_index, title, notes)
        VALUES (?, ?, ?, ?, ?)
      `
        );
        const insertStage = db.prepare(
            `
        INSERT INTO track_stages (id, track_id, stage_index, name, value)
        VALUES (?, ?, ?, ?, ?)
      `
        );

        songs.forEach((song, idx) => {
            const trackId = randomUUID();
            const trackIndex = idx + 1;
            const title =
                song.title && String(song.title).trim().length
                    ? String(song.title).trim()
                    : `Song ${trackIndex}`;
            const trackNotes =
                song.notes && String(song.notes).trim().length
                    ? String(song.notes).trim()
                    : null;

            insertTrack.run(trackId, pid, trackIndex, title, trackNotes);

            const stages = Array.isArray(song.stages) ? song.stages : [];
            stages.forEach((stage, sIdx) => {
                const numericValue = Number(stage.value);
                const stageName =
                    stage.name && String(stage.name).trim().length
                        ? String(stage.name).trim()
                        : `Stage ${sIdx + 1}`;

                insertStage.run(
                    randomUUID(),
                    trackId,
                    sIdx,
                    stageName,
                    Number.isFinite(numericValue) ? numericValue : 0
                );
            });
        });

        // Log snapshot for future undo / time-travel
        logProjectHistory(
            pid,
            snapshot,
            source || "api-state",
            description || null
        );

        return pid;
    }
);

// ---------- Express app ----------
const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// GET /api/state -> load "current" project
app.get("/api/state", (req, res) => {
    try {
        const snapshot = loadCurrentSnapshot();
        return res.json(snapshot);
    } catch (err) {
        console.error("Error reading state from DB:", err);
        return res.status(500).json({ error: "Failed to read state" });
    }
});

// POST /api/state -> save "current" project (creating it if needed)
app.post("/api/state", (req, res) => {
    try {
        const payload = req.body ?? {};
        const currentId = getCurrentProjectIdOrNull();

        saveSnapshotTx(
            currentId,
            payload,
            true,
            "api-state",
            "Save current project via /api/state"
        );

        return res.status(204).end();
    } catch (err) {
        console.error("Error writing state to DB:", err);
        return res.status(500).json({ error: "Failed to save state" });
    }
});

// List all projects (for future project picker UI)
app.get("/api/projects", (req, res) => {
    try {
        const rows = db
            .prepare(
                `
        SELECT p.id,
               p.title,
               p.type,
               p.status,
               p.target_iso AS targetISO,
               p.album_size AS albumSize,
               p.created_at AS createdAt,
               p.updated_at AS updatedAt,
               p.notes AS notes,
               a.name AS artistName
          FROM projects p
          LEFT JOIN artists a ON p.artist_id = a.id
         ORDER BY p.created_at DESC
      `
            )
            .all();
        res.json(rows);
    } catch (err) {
        console.error("Error listing projects:", err);
        res.status(500).json({ error: "Failed to list projects" });
    }
});

// Create a new empty project
app.post("/api/projects", (req, res) => {
    try {
        const {
            title = "Untitled Project",
            type = "album",
            status = "active",
            targetISO = null,
            artistName,
            notes
        } = req.body ?? {};

        let artistId;
        if (artistName && artistName.trim().length > 0) {
            const existing = db
                .prepare("SELECT id FROM artists WHERE name = ?")
                .get(artistName.trim());
            if (existing) {
                artistId = existing.id;
            } else {
                artistId = randomUUID();
                db.prepare("INSERT INTO artists (id, name) VALUES (?, ?)").run(
                    artistId,
                    artistName.trim()
                );
            }
        } else {
            artistId = getOrCreateDefaultArtistId();
        }

        const projectId = randomUUID();
        const cleanNotes =
            notes && String(notes).trim().length ? String(notes).trim() : null;

        db.prepare(
            `
        INSERT INTO projects (id, artist_id, title, type, status, target_iso, album_size, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        ).run(projectId, artistId, title, type, status, targetISO, null, cleanNotes);

        setCurrentProjectId(projectId);

        res.status(201).json({ id: projectId });
    } catch (err) {
        console.error("Error creating project:", err);
        res.status(500).json({ error: "Failed to create project" });
    }
});

// Load a specific project's snapshot
app.get("/api/projects/:id", (req, res) => {
    try {
        const { id } = req.params;
        const snapshot = loadSnapshotForProject(id);
        if (!snapshot) {
            return res.status(404).json({ error: "Project not found" });
        }
        res.json(snapshot);
    } catch (err) {
        console.error("Error loading project:", err);
        res.status(500).json({ error: "Failed to load project" });
    }
});

// Save a specific project's snapshot
app.post("/api/projects/:id", (req, res) => {
    try {
        const { id } = req.params;
        const payload = req.body ?? {};

        const existing = db
            .prepare("SELECT id FROM projects WHERE id = ?")
            .get(id);
        if (!existing) {
            return res.status(404).json({ error: "Project not found" });
        }

        saveSnapshotTx(
            id,
            payload,
            false,
            "api-project",
            `Save project ${id} via /api/projects/:id`
        );

        res.status(204).end();
    } catch (err) {
        console.error("Error saving project:", err);
        res.status(500).json({ error: "Failed to save project" });
    }
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
