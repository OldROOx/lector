import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload, FileText, RotateCcw, ChevronLeft, ChevronRight, Loader2,
  Sun, Moon, Type, BookOpen, Trash2, Pencil, Check, X, Library,
  Lock, Unlock, Eraser, Play,
} from "lucide-react";

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

// ── Limpieza automática: quita #, símbolos y todo lo que no sea letra útil ──
function cleanMarkdown(md) {
  return md
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")       // links -> texto
      .replace(/[#>*_`~|\\=+^]{1,}/g, " ")      // símbolos de markdown
      .replace(/^\s*[-•●◦]\s*/gm, " ")          // bullets
      .replace(/[\u2022\u25CF\u25AA]/g, " ")    // bullets unicode
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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

// ── Biblioteca en localStorage ────────────────────────────────────────
const LIB_KEY = "lector.library.v1";
const PREFS_KEY = "lector.prefs.v1";

function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; }
  catch { return []; }
}
function saveLibrary(lib) {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); }
  catch (e) { console.warn("No se pudo guardar la biblioteca:", e); }
}
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ||
        { theme: "dark", dyslexic: false };
  } catch { return { theme: "dark", dyslexic: false }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

// ══════════════════════════════════════════════════════════════════════
export default function App() {
  const pdfReady = usePdfJs();

  // biblioteca de libros: [{ id, name, markdown, idx, total, updatedAt }]
  const [library, setLibrary] = useState(loadLibrary);
  const [prefs, setPrefs] = useState(loadPrefs);

  // libro activo
  const [bookId, setBookId] = useState(null);
  const [words, setWords] = useState([]);
  const [idx, setIdx] = useState(0);

  // pantallas: "home" | "edit" | "read"
  const [screen, setScreen] = useState("home");
  const [draftMd, setDraftMd] = useState("");
  const [draftName, setDraftName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(true); // modo anti-accidentes
  const [confirmExit, setConfirmExit] = useState(false);
  const inputRef = useRef(null);
  const wordKey = useRef(0);

  // ── aplicar tema y fuente dislexia al <body> ──
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", prefs.theme);
    document.body.classList.toggle("dyslexic", prefs.dyslexic);
    savePrefs(prefs);
  }, [prefs]);

  // ── guardar progreso automáticamente cada vez que avanza ──
  useEffect(() => {
    if (!bookId || screen !== "read") return;
    setLibrary((lib) => {
      const next = lib.map((b) =>
          b.id === bookId ? { ...b, idx, updatedAt: Date.now() } : b
      );
      saveLibrary(next);
      return next;
    });
  }, [idx, bookId, screen]);

  // ── guardar también al cerrar la pestaña (anti-accidentes) ──
  useEffect(() => {
    const onUnload = (e) => {
      if (screen === "read" && locked) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [screen, locked]);

  const started = screen === "read" && words.length > 0;
  const done = started && idx >= words.length;

  const advance = useCallback((delta) => {
    wordKey.current++;
    setIdx((i) => Math.min(Math.max(i + delta, 0), words.length));
  }, [words.length]);

  // ── teclado: solo space y flechas cuentan; todo lo demás se ignora ──
  useEffect(() => {
    if (!started) return;
    const onKey = (e) => {
      if (e.code === "Space" || e.code === "ArrowRight") { e.preventDefault(); advance(1); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); advance(-1); }
      else if (e.code === "Escape") {
        e.preventDefault();
        if (locked) setConfirmExit(true);
        else goHome();
      }
      // cualquier otra tecla no hace nada = no te sales por accidente
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, advance, locked]);

  // ── flujo: subir PDF -> editor de markdown ──
  const handleFile = async (file) => {
    if (!file) return;
    if (!pdfReady) { setError("Todavía cargando el motor de PDF, espera un segundo…"); return; }
    setError(""); setLoading(true);
    try {
      const text = await pdfToText(file);
      const md = textToMarkdown(text);
      if (!md.trim()) throw new Error("No se encontró texto (¿es un PDF escaneado?).");
      setDraftMd(md);
      setDraftName(file.name.replace(/\.pdf$/i, ""));
      setBookId(null);
      setScreen("edit");
    } catch (err) {
      setError(err.message || "No se pudo leer el PDF.");
    } finally {
      setLoading(false);
    }
  };

  // ── editor -> guardar libro y empezar/continuar lectura ──
  const startReading = (md, name, existingId = null, startIdx = 0) => {
    const w = markdownToWords(md);
    if (!w.length) { setError("El texto quedó vacío."); return; }
    const id = existingId ||
        (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    setLibrary((lib) => {
      const exists = lib.some((b) => b.id === id);
      const next = exists
          ? lib.map((b) =>
              b.id === id ? { ...b, name, markdown: md, total: w.length, updatedAt: Date.now() } : b
          )
          : [
            { id, name, markdown: md, idx: startIdx, total: w.length, updatedAt: Date.now() },
            ...lib,
          ];
      saveLibrary(next);
      return next;
    });
    setBookId(id);
    setWords(w);
    setIdx(startIdx);
    setError("");
    setScreen("read");
  };

  const openBook = (book) => {
    const w = markdownToWords(book.markdown);
    setBookId(book.id);
    setWords(w);
    setIdx(Math.min(book.idx, w.length));
    setScreen("read");
  };

  const editBook = (book) => {
    setDraftMd(book.markdown);
    setDraftName(book.name);
    setBookId(book.id);
    setScreen("edit");
  };

  const deleteBook = (id) => {
    setLibrary((lib) => {
      const next = lib.filter((b) => b.id !== id);
      saveLibrary(next);
      return next;
    });
  };

  const goHome = () => {
    setScreen("home");
    setWords([]);
    setIdx(0);
    setBookId(null);
    setConfirmExit(false);
    setError("");
  };

  const toggleTheme = () =>
      setPrefs((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" }));
  const toggleDyslexic = () =>
      setPrefs((p) => ({ ...p, dyslexic: !p.dyslexic }));

  const prev = idx > 0 ? words[idx - 1] : "";
  const curr = words[idx] || "";
  const next = idx + 1 < words.length ? words[idx + 1] : "";
  const progress = words.length ? Math.min(idx / words.length, 1) : 0;

  // ── barra superior compartida ──
  const TopBar = ({ children }) => (
      <div className="flex items-center gap-2 px-5 py-3">
        {children}
        <div className="flex-1" />
        <button className="aero-btn p-2.5" onClick={toggleDyslexic}
                title="Fuente para dislexia"
                style={prefs.dyslexic ? { boxShadow: "0 0 0 2px var(--accent)" } : {}}>
          <Type className="w-4 h-4" />
        </button>
        <button className="aero-btn p-2.5" onClick={toggleTheme} title="Cambiar tema">
          {prefs.theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
  );

  // ══════════════════ PANTALLA: HOME / BIBLIOTECA ══════════════════
  if (screen === "home") {
    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
          <TopBar>
          <span className="text-sm cursor-blink" style={{ color: "var(--accent)" }}>
            lector://
          </span>
          </TopBar>

          <div className="flex-1 flex flex-col items-center px-6 pb-10 pt-4">
            <div className="w-full max-w-2xl fade-up">
              <h1 className="text-4xl font-extrabold tracking-tight glow"
                  style={{ color: "var(--accent)" }}>
                Lector veloz
              </h1>
              <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
                Sube un PDF y léelo palabra por palabra. Tu progreso se guarda solo.
              </p>

              <button
                  onClick={() => inputRef.current?.click()}
                  disabled={loading || !pdfReady}
                  className="aero-btn mt-8 w-full !rounded-3xl p-10 flex flex-col items-center gap-3"
              >
                {loading ? (
                    <>
                      <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
                      <span className="text-sm" style={{ color: "var(--text-dim)" }}>Convirtiendo PDF…</span>
                    </>
                ) : (
                    <>
                      <Upload className="w-8 h-8" style={{ color: "var(--accent)" }} />
                      <span className="font-bold">Subir PDF</span>
                      <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                    {pdfReady ? "Se convierte a texto editable antes de leer" : "Cargando motor de PDF…"}
                  </span>
                    </>
                )}
              </button>

              <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
                     onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />

              {error && (
                  <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: "var(--danger)" }}>
                    <FileText className="w-4 h-4" /> {error}
                  </div>
              )}

              {/* ── Biblioteca ── */}
              {library.length > 0 && (
                  <div className="mt-10 fade-up">
                    <div className="flex items-center gap-2 mb-3 text-sm font-bold"
                         style={{ color: "var(--text-dim)" }}>
                      <Library className="w-4 h-4" /> TU BIBLIOTECA
                    </div>
                    <div className="flex flex-col gap-3">
                      {library.map((b) => {
                        const pct = b.total ? Math.round((b.idx / b.total) * 100) : 0;
                        return (
                            <div key={b.id}
                                 className="aero-btn !rounded-2xl p-4 flex items-center gap-4 text-left"
                                 style={{ cursor: "default" }}>
                              <BookOpen className="w-6 h-6 shrink-0" style={{ color: "var(--accent)" }} />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold truncate">{b.name}</p>
                                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden"
                                     style={{ background: "var(--panel-border)" }}>
                                  <div className="h-full rounded-full transition-all duration-500"
                                       style={{ width: `${pct}%`, background: "var(--accent)" }} />
                                </div>
                                <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                                  {pct}% · palabra {b.idx.toLocaleString()} de {b.total.toLocaleString()}
                                </p>
                              </div>
                              <button className="aero-btn primary p-3" title="Continuar leyendo"
                                      onClick={() => openBook(b)}>
                                <Play className="w-4 h-4" />
                              </button>
                              <button className="aero-btn p-3" title="Editar texto"
                                      onClick={() => editBook(b)}>
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button className="aero-btn p-3" title="Eliminar"
                                      onClick={() => deleteBook(b.id)}>
                                <Trash2 className="w-4 h-4" style={{ color: "var(--danger)" }} />
                              </button>
                            </div>
                        );
                      })}
                    </div>
                  </div>
              )}
            </div>
          </div>
        </div>
    );
  }

  // ══════════════════ PANTALLA: EDITOR DE MARKDOWN ══════════════════
  if (screen === "edit") {
    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
          <TopBar>
            <button className="aero-btn p-2.5" onClick={goHome} title="Volver">
              <X className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>
            editor de texto
          </span>
          </TopBar>

          <div className="flex-1 flex flex-col px-6 pb-6 max-w-4xl w-full mx-auto fade-up">
            <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Nombre del libro"
                className="mb-3 px-4 py-3 rounded-2xl outline-none font-bold text-lg"
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--panel-border)",
                  color: "var(--text)",
                }}
            />

            <textarea
                value={draftMd}
                onChange={(e) => setDraftMd(e.target.value)}
                spellCheck={false}
                className="flex-1 min-h-[50vh] p-4 rounded-2xl outline-none resize-none text-sm leading-relaxed"
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--panel-border)",
                  color: "var(--text)",
                  fontFamily: "inherit",
                }}
            />

            <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
              Edita lo que quieras. "Limpiar símbolos" quita #, *, bullets y todo lo que no sea texto.
            </p>

            <div className="flex gap-3 mt-4">
              <button className="aero-btn px-5 py-3 flex items-center gap-2 font-bold"
                      onClick={() => setDraftMd(cleanMarkdown(draftMd))}>
                <Eraser className="w-4 h-4" /> Limpiar símbolos
              </button>
              <div className="flex-1" />
              <button className="aero-btn primary px-6 py-3 flex items-center gap-2 font-bold"
                      onClick={() => startReading(draftMd, draftName || "Sin título", bookId,
                          bookId ? (library.find((b) => b.id === bookId)?.idx ?? 0) : 0)}>
                <Check className="w-4 h-4" /> Guardar y leer
              </button>
            </div>

            {error && (
                <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>{error}</p>
            )}
          </div>
        </div>
    );
  }

  // ══════════════════ PANTALLA: LECTURA ══════════════════
  return (
      <div className="min-h-screen flex flex-col select-none" style={{ background: "var(--bg)" }}>
        {/* barra de progreso */}
        <div className="h-1" style={{ background: "var(--panel-border)" }}>
          <div className="h-full transition-all duration-150"
               style={{ width: `${progress * 100}%`, background: "var(--accent)" }} />
        </div>

        {/* header */}
        <div className="flex items-center gap-2 px-5 py-3 text-sm" style={{ color: "var(--text-dim)" }}>
          <button className="aero-btn p-2"
                  title={locked ? "Bloqueado: pide confirmación para salir" : "Desbloqueado"}
                  onClick={() => setLocked((l) => !l)}
                  style={locked ? { boxShadow: "0 0 0 2px var(--accent)" } : {}}>
            {locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
          <span className="truncate max-w-[40%]">
          {library.find((b) => b.id === bookId)?.name}
        </span>
          <div className="flex-1" />
          <span>{Math.min(idx + 1, words.length)} / {words.length}</span>
          <button className="aero-btn p-2 ml-2" onClick={toggleDyslexic} title="Fuente para dislexia"
                  style={prefs.dyslexic ? { boxShadow: "0 0 0 2px var(--accent)" } : {}}>
            <Type className="w-4 h-4" />
          </button>
          <button className="aero-btn p-2" onClick={toggleTheme} title="Cambiar tema">
            {prefs.theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* zona de lectura */}
        <div
            className="flex-1 flex items-center justify-center px-4 cursor-pointer"
            onClick={() => !done && advance(1)}
        >
          {done ? (
              <div className="text-center fade-up">
                <p className="text-3xl font-extrabold mb-2 glow" style={{ color: "var(--accent)" }}>
                  Fin ✦
                </p>
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Terminaste el documento.
                </p>
              </div>
          ) : (
              <div className="flex items-baseline justify-center gap-5 w-full">
            <span className="text-2xl sm:text-3xl truncate flex-1 text-right transition-opacity"
                  style={{ color: "var(--text-faint)" }}>
              {prev}
            </span>
                <span key={wordKey.current}
                      className="word-in glow text-5xl sm:text-7xl font-extrabold whitespace-nowrap px-2"
                      style={{ color: "var(--accent)" }}>
              {curr}
            </span>
                <span className="text-2xl sm:text-3xl truncate flex-1 text-left transition-opacity"
                      style={{ color: "var(--text-faint)" }}>
              {next}
            </span>
              </div>
          )}
        </div>

        {/* controles */}
        <div className="flex items-center justify-center gap-3 pb-8 pt-2">
          <button onClick={() => advance(-1)} disabled={idx === 0} className="aero-btn p-3.5">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={() => !done && advance(1)} disabled={done} className="aero-btn primary p-4">
            <Play className="w-5 h-5" />
          </button>
          <button onClick={() => advance(1)} disabled={done} className="aero-btn p-3.5">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button className="aero-btn p-3.5 ml-2"
                  onClick={() => (locked ? setConfirmExit(true) : goHome())}
                  title="Salir a la biblioteca">
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>

        <p className="text-center text-xs pb-4" style={{ color: "var(--text-faint)" }}>
          <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--panel)" }}>space</kbd> avanzar ·{" "}
          <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--panel)" }}>←</kbd> atrás ·{" "}
          <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--panel)" }}>esc</kbd> salir
        </p>

        {/* ── modal de confirmación anti-accidentes ── */}
        {confirmExit && (
            <div className="fixed inset-0 flex items-center justify-center z-50 fade-up"
                 style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}>
              <div className="aero-btn !rounded-3xl p-8 max-w-sm text-center"
                   style={{ cursor: "default", background: "var(--bg-soft)" }}>
                <Lock className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--accent)" }} />
                <p className="font-bold text-lg mb-1">¿Salir de la lectura?</p>
                <p className="text-sm mb-6" style={{ color: "var(--text-dim)" }}>
                  Tu progreso ya está guardado. Puedes continuar después.
                </p>
                <div className="flex gap-3 justify-center">
                  <button className="aero-btn px-5 py-3 font-bold"
                          onClick={() => setConfirmExit(false)}>
                    Seguir leyendo
                  </button>
                  <button className="aero-btn primary px-5 py-3 font-bold" onClick={goHome}>
                    Salir
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}