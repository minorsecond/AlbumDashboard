import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Album Progress Dashboard — v3
 * Changes in this pass:
 * - Card size: h-[462px] w-[370px] (fits 2×5 on 1920×1080)
 * - No footer; page has no outer scrollbar (overflow-hidden)
 * - Stage title is inside the progress bar (no % text in bars)
 * - Remove button (×) inline to the right of each bar
 * - Clicking a bar opens a modal that lets you edit the stage name + progress (with slider)
 * - No max stage count; scroll appears inside card if too many
 * - “+” only for Add Bit button
 * - Zoom view centers a single song on a pure black background; UI is the same but enlarged
 *
 * Album Progress Dashboard - v4
 * Changes in this pass:
 * - Fix some screen size issues
 */

const DEFAULT_STAGE_NAMES = [
    "Demo",
    "Basic Track",
    "Instruments",
    "Lyrics",
    "Vocals",
    "Mix",
];

/* huge number because some punk albums lots of very short tunes */
const MAX_SONGS = 35;

const DEFAULT_SONGS = Array.from({ length: MAX_SONGS }).map((_, i) => ({
    id: i + 1,
    title: `Song ${i + 1}`,
    stages: DEFAULT_STAGE_NAMES.map((name) => ({ name, value: 0 })),
}));

const STORAGE_KEY = "albumProgress_v3";

function useHashRoute() {
    const [hash, setHash] = useState(() => window.location.hash);
    useEffect(() => {
        const onHash = () => setHash(window.location.hash);
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);
    return hash;
}

function formatDHMS(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
}

function useCountdown(targetISO) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    const target = useMemo(() => new Date(targetISO).getTime(), [targetISO]);
    const remaining = Math.max(0, target - now);
    return formatDHMS(remaining);
}

const clamp01 = (v) => Math.min(100, Math.max(0, v));

function ProgressBar({ value, editable = false, onClick, height = "h-4", label }) {
    const pct = clamp01(value);
    const barColor = pct >= 100 ? "bg-emerald-700" : "bg-amber-700";
    return (
        <div className="w-full flex items-center gap-2">
            <div
                className={`relative w-full ${height} bg-neutral-800 rounded-full overflow-hidden ${
                    editable ? "cursor-pointer" : ""
                }`}
                onClick={editable ? onClick : undefined}
                title={editable ? "Click to edit" : undefined}
            >
                <div
                    className={`h-full ${barColor} transition-[width] duration-200 ease-out`}
                    style={{ width: `${pct}%` }}
                />
                {label && (
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] sm:text-sm font-medium text-white/90">
                        {label}
                    </div>
                )}
            </div>
        </div>
    );
}

function EditableText({ text, onSubmit, className, placeholder }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(text || "");
    useEffect(() => setVal(text || ""), [text]);
    return editing ? (
        <input
            className={`bg-neutral-900 border border-neutral-700 rounded px-2 py-1 w-full focus:outline-none focus:ring ${
                className || ""
            }`}
            value={val}
            placeholder={placeholder}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => {
                setEditing(false);
                onSubmit((val || placeholder || text || "").trim());
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                    setVal(text || "");
                    setEditing(false);
                }
            }}
            autoFocus
        />
    ) : (
        <div className={`cursor-text ${className || ""}`} onClick={() => setEditing(true)}>
            {val || placeholder || ""}
        </div>
    );
}

function EditStagePrompt({ initialName, initialValue, onClose }) {
    const [name, setName] = useState(initialName || "");
    const [val, setVal] = useState(String(initialValue ?? 0));

    const content = (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 w-full max-w-md space-y-4">
                <div className="text-lg font-semibold">Edit bit</div>

                <div className="space-y-2">
                    <label className="text-sm text-neutral-300">Name</label>
                    <input
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 focus:outline-none"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-sm text-neutral-300">
                        Progress: {clamp01(Number(val) || 0)}%
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={Number(val) || 0}
                        onChange={(e) => setVal(e.target.value)}
                        className="w-full"
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.preventDefault()}
                    />
                </div>

                <div className="flex gap-2 justify-end">
                    <button
                        className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                        onClick={() => onClose(null)}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500"
                        onClick={() =>
                            onClose({
                                name: name.trim() || initialName,
                                value: clamp01(Number(val) || 0),
                            })
                        }
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );

    // In SSR or very early render, `document` might not exist.
    if (typeof document === "undefined") {
        return content;
    }

    return createPortal(content, document.body);
}

function ExportImport({ songs, albumTitle }) {
    const exportJSON = async () => {
        const data = JSON.stringify({ songs, albumTitle }, null, 2);

        if ("showSaveFilePicker" in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: "album_dashboard.json",
                    types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(new Blob([data], { type: "application/json" }));
                await writable.close();
                return;
            } catch (e) {
                if (e?.name === "AbortError") return;
                console.error(e);
                alert("Could not save using the file picker. Falling back to download.");
            }
        }

        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "album_dashboard.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    const importJSON = async () => {
        if ("showOpenFilePicker" in window) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
                    multiple: false,
                });
                const file = await handle.getFile();
                const txt = await file.text();
                const data = JSON.parse(txt);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                window.location.reload();
                return;
            } catch (e) {
                if (e?.name === "AbortError") return;
                console.error(e);
                alert("Could not open using the file picker. Falling back to upload.");
            }
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            file.text().then((txt) => {
                try {
                    const data = JSON.parse(txt);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                    window.location.reload();
                } catch {
                    alert("Invalid JSON file");
                }
            });
        };
        input.click();
    };

    const resetData = () => {
        if (confirm("Reset all data to defaults?")) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
        }
    };
    return (
        <div className="flex items-center gap-2">
            <button
                className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={exportJSON}
            >
                Export
            </button>
            <button
                className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={importJSON}
            >
                Import
            </button>
            <button
                className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={resetData}
            >
                Reset
            </button>
        </div>
    );
}

function songAverage(song) {
    if (!song.stages?.length) return 0;
    const sum = song.stages.reduce((a, s) => a + clamp01(s.value || 0), 0);
    return Math.round((100 * sum) / (song.stages.length * 100));
}

function albumAverage(songs) {
    if (!songs.length) return 0;
    const sum = songs.reduce((a, s) => a + songAverage(s), 0);
    return Math.round(sum / songs.length);
}

function eligibleCount(songs, threshold = 75) {
    return [...songs].filter((s) => songAverage(s) >= threshold).length;
}

function Header({ targetISO, setTargetISO, songs, albumTitle, setAlbumTitle }) {
    const { days, hours, minutes, seconds } = useCountdown(targetISO);
    const [editingDate, setEditingDate] = useState(false);

    return (
        <div className="w-full flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-4">
                <EditableText
                    text={albumTitle}
                    onSubmit={setAlbumTitle}
                    className="text-2xl font-black tracking-wider"
                    placeholder="Album Title"
                />
            </div>

            <div className="text-2xl font-black tracking-wider">
                {eligibleCount(songs, 75)}/20
            </div>

            <div className="flex items-center gap-3 text-right">
                {editingDate ? (
                    <input
                        type="datetime-local"
                        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                        value={toLocalDatetimeInputValue(targetISO)}
                        onChange={(e) => setTargetISO(fromLocalDatetimeInputValue(e.target.value))}
                        onBlur={() => setEditingDate(false)}
                        autoFocus
                    />
                ) : (
                    <div
                        className="cursor-pointer"
                        onClick={() => setEditingDate(true)}
                        title="Click to edit target deadline"
                    >
                        <div className="uppercase text-xs tracking-widest text-neutral-400">
                            Time to Goal
                        </div>
                        <div className="text-2xl tabular-nums font-semibold">
                            {days}d {String(hours).padStart(2, "0")}:
                            {String(minutes).padStart(2, "0")}:
                            {String(seconds).padStart(2, "0")}
                        </div>
                        <div className="text-xs text-neutral-500">
                            Target: {new Date(targetISO).toLocaleString()}
                        </div>
                    </div>
                )}
                <ExportImport songs={songs} albumTitle={albumTitle} />
            </div>
        </div>
    );
}

/**
 * StageRow — drag-to-reorder with a small grab handle to avoid conflicts.
 */
function StageRow({
                      stage,
                      index,
                      onApply,
                      onRemove,
                      stageRowHeight = "h-4",
                      draggingIndex,
                      onDragStartRow,
                      onDragEnterRow,
                  }) {
    const [promptOpen, setPromptOpen] = useState(false);

    const handleDragStart = () => {
        onDragStartRow?.(index);
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        onDragEnterRow?.(index);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    return (
        <div
            className={`flex items-center gap-2 ${
                draggingIndex === index ? "opacity-60" : ""
            }`}
        >
            {/* Drag handle only */}
            <div
                className="shrink-0 w-4 h-4 flex items-center justify-center text-neutral-500
                cursor-grab active:cursor-grabbing select-none hover:text-neutral-300"
                draggable
                onDragStart={handleDragStart}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                title="Drag to reorder"
            >
                ⋮⋮
            </div>

            <div className="flex-1">
                <ProgressBar
                    value={stage.value}
                    label={stage.name}
                    editable
                    onClick={() => setPromptOpen(true)}
                    height={stageRowHeight}
                />
            </div>

            <button
                className="shrink-0 w-6 h-3 flex items-center justify-center rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                onClick={onRemove}
                title="Remove"
            >
                ×
            </button>

            {promptOpen && (
                <EditStagePrompt
                    initialName={stage.name}
                    initialValue={stage.value}
                    onClose={(res) => {
                        setPromptOpen(false);
                        if (!res) return;
                        onApply(res.name, res.value);
                    }}
                />
            )}
        </div>
    );
}

function SongCard({ song, onUpdate, onZoom }) {
    const avg = songAverage(song);

    const cardBorderClass =
        avg >= 100
            ? "border-emerald-600"
            : avg >= 75
                ? "border-amber-600"
                : avg > 0
                    ? "border-neutral-700"
                    : "border-neutral-800";

    const updateStageAt = (idx, patch) => {
        const stages = song.stages.map((s, i) => (i === idx ? { ...s, ...patch } : s));
        onUpdate({ ...song, stages });
    };

    const removeStageAt = (idx) =>
        onUpdate({
            ...song,
            stages: song.stages.filter((_, i) => i !== idx),
        });

    const addStage = () =>
        onUpdate({
            ...song,
            stages: [...song.stages, { name: `Stage ${song.stages.length + 1}`, value: 0 }],
        });

    const moveStage = (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;
        const updatedStages = [...song.stages];
        const [moved] = updatedStages.splice(fromIndex, 1);
        updatedStages.splice(toIndex, 0, moved);
        onUpdate({ ...song, stages: updatedStages });
    };

    const [draggingIndex, setDraggingIndex] = useState(null);

    const handleDragStartRow = (index) => {
        setDraggingIndex(index);
    };

    const handleDragEnterRow = (index) => {
        if (draggingIndex === null || draggingIndex === index) return;
        moveStage(draggingIndex, index);
        setDraggingIndex(index);
    };

    useEffect(() => {
        const clear = () => setDraggingIndex(null);
        window.addEventListener("dragend", clear);
        window.addEventListener("drop", clear);
        return () => {
            window.removeEventListener("dragend", clear);
            window.removeEventListener("drop", clear);
        };
    }, []);

    const resetStages = () =>
        onUpdate({
            ...song,
            stages: song.stages.map((s) => ({ ...s, value: 0 })),
        });

    const completeSong = () =>
        onUpdate({
            ...song,
            stages: song.stages.map((s) => ({ ...s, value: 100 })),
        });

    return (
        <div
            className={`bg-neutral-900 border ${cardBorderClass} rounded-xl h-[232px] w-full max-w-sm px-3 pt-2 pb-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-400 flex flex-col`}
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <EditableText
                    text={song.title}
                    onSubmit={(t) => onUpdate({ ...song, title: t })}
                    className="font-bold leading-tight text-xl tracking-wider"
                />
                <button
                    className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                    onClick={() => onZoom(song.id)}
                    title="Zoom"
                >
                    Zoom
                </button>
            </div>

            <div className="relative mb-2">
                <ProgressBar value={avg} height="h-5" />
                <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-sm">
          {avg}%
        </span>
            </div>

            <div className="flex-1 overflow-auto pr-1 pt-1">
                <div className="flex flex-col gap-1">
                    {song.stages.map((stg, idx) => (
                        <StageRow
                            key={`${stg.name}-${idx}`}
                            stage={stg}
                            index={idx}
                            onApply={(name, value) => updateStageAt(idx, { name, value })}
                            onRemove={() => removeStageAt(idx)}
                            draggingIndex={draggingIndex}
                            onDragStartRow={handleDragStartRow}
                            onDragEnterRow={handleDragEnterRow}
                        />
                    ))}
                </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1">
                    <button
                        className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 hover:bg-neutral-800"
                        onClick={resetStages}
                    >
                        Reset
                    </button>
                    <button
                        className="px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600"
                        onClick={completeSong}
                    >
                        100%
                    </button>
                </div>
                <button
                    className="w-6 h-5 flex items-center justify-center text-sm rounded bg-neutral-800 hover:bg-neutral-700"
                    onClick={addStage}
                    title="Add bit"
                >
                    +
                </button>
            </div>
        </div>
    );
}

function SongDetail({ song, onUpdate, onBack }) {
    const avg = songAverage(song);

    const updateStageAt = (idx, patch) => {
        const stages = song.stages.map((s, i) => (i === idx ? { ...s, ...patch } : s));
        onUpdate({ ...song, stages });
    };

    const removeStageAt = (idx) =>
        onUpdate({
            ...song,
            stages: song.stages.filter((_, i) => i !== idx),
        });

    const addStage = () =>
        onUpdate({
            ...song,
            stages: [...song.stages, { name: `Stage ${song.stages.length + 1}`, value: 0 }],
        });

    const moveStage = (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;
        const updatedStages = [...song.stages];
        const [moved] = updatedStages.splice(fromIndex, 1);
        updatedStages.splice(toIndex, 0, moved);
        onUpdate({ ...song, stages: updatedStages });
    };

    const [draggingIndex, setDraggingIndex] = useState(null);

    const handleDragStartRow = (index) => {
        setDraggingIndex(index);
    };

    const handleDragEnterRow = (index) => {
        if (draggingIndex === null || draggingIndex === index) return;
        moveStage(draggingIndex, index);
        setDraggingIndex(index);
    };

    useEffect(() => {
        const clear = () => setDraggingIndex(null);
        window.addEventListener("dragend", clear);
        window.addEventListener("drop", clear);
        return () => {
            window.removeEventListener("dragend", clear);
            window.removeEventListener("drop", clear);
        };
    }, []);

    return (
        <div className="h-screen w-screen bg-black flex items-center justify-center">
            <div
                className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-lg flex flex-col"
                style={{ width: 740, height: 724 }}
            >
                <div className="flex items-center justify-between mb-4">
                    <EditableText
                        text={song.title}
                        onSubmit={(t) => onUpdate({ ...song, title: t })}
                        className="text-3xl font-bold"
                    />
                    <button
                        className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                        onClick={onBack}
                    >
                        Back to Grid
                    </button>
                </div>

                <div className="relative mb-3">
                    <ProgressBar value={avg} height="h-9" />
                    <span className="absolute inset-0 flex items-center justify-center text-white font-bold">
            {avg}%
          </span>
                </div>

                <div className="flex-1 overflow-auto pr-1">
                    <div className="flex flex-col gap-3">
                        {song.stages.map((stg, idx) => (
                            <StageRow
                                key={`${stg.name}-${idx}`}
                                stage={stg}
                                index={idx}
                                onApply={(name, value) => updateStageAt(idx, { name, value })}
                                onRemove={() => removeStageAt(idx)}
                                stageRowHeight="h-8"
                                draggingIndex={draggingIndex}
                                onDragStartRow={handleDragStartRow}
                                onDragEnterRow={handleDragEnterRow}
                            />
                        ))}
                    </div>
                </div>

                <div className="pt-3 flex items-center justify-between">
                    <button
                        className="w-9 h-9 flex items-center justify-center text-lg rounded bg-neutral-800 hover:bg-neutral-700"
                        onClick={addStage}
                    >
                        +
                    </button>
                </div>
            </div>
        </div>
    );
}

function toLocalDatetimeInputValue(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalDatetimeInputValue(value) {
    const d = new Date(value);
    return d.toISOString();
}

export default function App() {
    const stored = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        } catch {
            return {};
        }
    }, []);

    const migrateSongs = (s) => {
        if (!s) return DEFAULT_SONGS;
        return s.map((song) => {
            if (Array.isArray(song.stages)) return song; // v2+
            if (song.stages && typeof song.stages === "object") {
                const entries = Object.entries(song.stages).map(([name, value]) => ({
                    name,
                    value: Number(value) || 0,
                }));
                return { ...song, stages: entries };
            }
            return {
                ...song,
                stages: DEFAULT_STAGE_NAMES.map((n) => ({ name: n, value: 0 })),
            };
        });
    };

    const [songs, setSongs] = useState(() => migrateSongs(stored.songs) || DEFAULT_SONGS);
    const [albumTitle, setAlbumTitle] = useState(
        () => stored.albumTitle || "Album Dashboard"
    );
    const [targetISO, setTargetISO] = useState(
        () => stored.targetISO || new Date("2026-08-01T00:00:00").toISOString()
    );

    // How many tracks are actually on this album (just visibility/logic, not storage)
    const [songCount, setSongCount] = useState(() => {
        const saved = Number(stored.songCount);
        if (Number.isFinite(saved) && saved > 0) {
            return saved;
        }
        if (stored.songs && Array.isArray(stored.songs) && stored.songs.length) {
            return stored.songs.length;
        }
        return DEFAULT_SONGS.length;
    });

    // Clamp songCount to the current songs length whenever songs change (e.g. import)
    useEffect(() => {
        setSongCount((current) => {
            const max = songs.length || 1;
            if (!Number.isFinite(current) || current < 1) return 1;
            if (current > max) return max;
            return current;
        });
    }, [songs.length]);

    const handleSongCountChange = (raw) => {
        const requested = Number(raw);
        if (!Number.isFinite(requested)) return;
        const max = songs.length || 1;
        const clamped = Math.min(max, Math.max(1, requested));
        setSongCount(clamped);
    };

    const hash = useHashRoute();
    const songIdFromHash = useMemo(() => {
        if (hash && hash.startsWith("#song/")) {
            const num = Number(hash.slice(6));
            return Number.isFinite(num) ? num : null;
        }
        return null;
    }, [hash]);

    const currentSong = songIdFromHash
        ? songs.find((s) => s.id === songIdFromHash)
        : null;

    // Only the first `songCount` songs are treated as part of the album
    const visibleSongs = useMemo(
        () => songs.slice(0, songCount),
        [songs, songCount]
    );

    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ songs, targetISO, albumTitle, songCount })
        );
    }, [songs, targetISO, albumTitle, songCount]);

    const updateSong = (updated) =>
        setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

    useEffect(() => {
        document.title = albumTitle + " " + "Planning" || "Album Dashboard";
    }, [albumTitle]);

    return (
        <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 overflow-x-auto">
            {currentSong ? (
                <SongDetail
                    song={currentSong}
                    onUpdate={updateSong}
                    onBack={() => (window.location.hash = "")}
                />
            ) : (
                <>
                    <Header
                        targetISO={targetISO}
                        setTargetISO={setTargetISO}
                        songs={visibleSongs}
                        albumTitle={albumTitle}
                        setAlbumTitle={setAlbumTitle}
                        albumSize={songCount}
                    />

                    {/* Album-wide overall progress (with % in center) */}
                    <div className="px-4 -mt-2 pb-2 relative">
                        <ProgressBar value={albumAverage(visibleSongs)} height="h-9" />
                        <span
                            className="absolute inset-0 text-white font-bold"
                            style={{
                                lineHeight: "36px", // match h-9 (36px)
                                textAlign: "center",
                            }}
                        >
              {albumAverage(visibleSongs)}%
            </span>
                    </div>
                    <div className="px-4 pb-2 flex items-center justify-between text-xs text-neutral-400">
                        <span>Tracks in album: {songCount}</span>
                        <label className="flex items-center gap-2">
                            <span>Album tracks</span>
                            <input
                                type="number"
                                min={1}
                                max={songs.length}
                                value={songCount}
                                onChange={(e) => handleSongCountChange(e.target.value)}
                                className="w-16 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs"
                            />
                        </label>
                    </div>

                    <div className="px-4 pb-4 h-[calc(100vh-140px)] overflow-auto">
                        <div className="grid gap-3 justify-items-stretch xl:grid-cols-5 lg:grid-cols-4 md:grid-cols-3 sm:grid-cols-2 grid-cols-1">
                            {visibleSongs.map((song) => (
                                <SongCard
                                    key={song.id}
                                    song={song}
                                    onUpdate={updateSong}
                                    onZoom={(id) => (window.location.hash = `#song/${id}`)}
                                />
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
