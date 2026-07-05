import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, FileText, Play, RotateCcw, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// ── Carga pdf.js dinámicamente desde cdnjs ────────────────────────────
function usePdfJs() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      setReady(true);
    };
    document.body.appendChild(s);
  }, []);
  return ready;
}

// ── PDF -> texto plano por página ─────────────────────────────────────
async function pdfToText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let lastY = null, line = "";
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 5) {
        full += line.trim() + "\n";
        line = "";
      }
      line += item.str + " ";
      lastY = y;
    }
    full += line.trim() + "\n\n";
  }
  return full;
}

// ── Heurística simple texto -> markdown ───────────────────────────────
function textToMarkdown(text) {
  const lines = text.split("\n");
  const out = [];
  for (let raw of lines) {
    const l = raw.trim();
    if (!l) { out.push(""); continue; }
    const isShort = l.length < 60;
    const isUpper = l === l.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(l);
    const noEnd = !/[.:;,]$/.test(l);
    if (isShort && isUpper) out.push("# " + l.replace(/\s+/g, " "));
    else if (isShort && noEnd && /^\d+[.)]?\s/.test(l)) out.push("## " + l);
    else out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Markdown -> tokens de palabras ────────────────────────────────────
function markdownToWords(md) {
  return md
      .replace(/[#>*_`~\-]{1,}/g, " ")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);
}

export default function App() {
  const pdfReady = usePdfJs();
  const [words, setWords] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const started = words.length > 0;
  const done = started && idx >= words.length;

  const advance = useCallback((delta) => {
    setIdx((i) => Math.min(Math.max(i + delta, 0), words.length));
  }, [words.length]);

  useEffect(() => {
    if (!started) return;
    const onKey = (e) => {
      if (e.code === "Space") { e.preventDefault(); advance(1); }
      else if (e.code === "ArrowRight") { e.preventDefault(); advance(1); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); advance(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, advance]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!pdfReady) { setError("Todavía cargando el motor de PDF, espera un segundo…"); return; }
    setError(""); setLoading(true); setFileName(file.name);
    try {
      const text = await pdfToText(file);
      const md = textToMarkdown(text);
      const w = markdownToWords(md);
      if (!w.length) throw new Error("No se encontró texto (¿es un PDF escaneado?).");
      setWords(w); setIdx(0);
    } catch (err) {
      setError(err.message || "No se pudo leer el PDF.");
      setWords([]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setWords([]); setIdx(0); setFileName(""); setError(""); };

  const prev = idx > 0 ? words[idx - 1] : "";
  const curr = words[idx] || "";
  const next = idx + 1 < words.length ? words[idx + 1] : "";
  const progress = words.length ? Math.min(idx / words.length, 1) : 0;

  if (!started) {
    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6 font-sans">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold tracking-tight">Lector veloz</h1>
              <p className="text-neutral-400 mt-2 text-sm">
                Sube un PDF y léelo palabra por palabra. Presiona <kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-xs">space</kbd> para avanzar.
              </p>
            </div>

            <button
                onClick={() => inputRef.current?.click()}
                disabled={loading || !pdfReady}
                className="w-full border-2 border-dashed border-neutral-700 hover:border-neutral-500 rounded-2xl p-10 flex flex-col items-center gap-3 transition-colors disabled:opacity-50"
            >
              {loading ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
                    <span className="text-neutral-400 text-sm">Convirtiendo “{fileName}”…</span>
                  </>
              ) : (
                  <>
                    <Upload className="w-8 h-8 text-neutral-400" />
                    <span className="font-medium">Subir PDF</span>
                    <span className="text-neutral-500 text-xs">
                  {pdfReady ? "Se convierte a markdown y empieza la lectura" : "Cargando motor de PDF…"}
                </span>
                  </>
              )}
            </button>

            <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
            />

            {error && (
                <div className="mt-4 flex items-center gap-2 text-red-400 text-sm">
                  <FileText className="w-4 h-4" /> {error}
                </div>
            )}
          </div>
        </div>
    );
  }

  return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none">
        <div className="h-1 bg-neutral-800">
          <div className="h-full bg-emerald-500 transition-all duration-100" style={{ width: `${progress * 100}%` }} />
        </div>

        <div className="flex items-center justify-between px-5 py-3 text-sm text-neutral-400">
          <span className="truncate max-w-[50%]">{fileName}</span>
          <span>{Math.min(idx + 1, words.length)} / {words.length}</span>
        </div>

        <div
            className="flex-1 flex items-center justify-center px-4 cursor-pointer"
            onClick={() => !done && advance(1)}
        >
          {done ? (
              <div className="text-center">
                <p className="text-2xl font-semibold mb-2">Fin ✦</p>
                <p className="text-neutral-500 text-sm">Terminaste el documento.</p>
              </div>
          ) : (
              <div className="flex items-baseline justify-center gap-4 w-full">
                <span className="text-neutral-600 text-xl sm:text-2xl truncate flex-1 text-right">{prev}</span>
                <span className="text-emerald-400 text-4xl sm:text-6xl font-bold whitespace-nowrap px-2">{curr}</span>
                <span className="text-neutral-600 text-xl sm:text-2xl truncate flex-1 text-left">{next}</span>
              </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 pb-8 pt-2">
          <button onClick={() => advance(-1)} disabled={idx === 0}
                  className="p-3 rounded-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={() => !done && advance(1)} disabled={done}
                  className="p-4 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition-colors">
            <Play className="w-5 h-5" />
          </button>
          <button onClick={() => advance(1)} disabled={done}
                  className="p-3 rounded-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button onClick={reset}
                  className="p-3 rounded-full bg-neutral-800 hover:bg-neutral-700 transition-colors ml-2">
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>

        <p className="text-center text-neutral-600 text-xs pb-4">
          <kbd className="px-1.5 py-0.5 bg-neutral-800 rounded">space</kbd> avanzar ·
          <kbd className="px-1.5 py-0.5 bg-neutral-800 rounded ml-1">←</kbd> atrás
        </p>
      </div>
  );
}