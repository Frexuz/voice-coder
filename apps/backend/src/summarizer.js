// Minimal deterministic summarizer for Phase 3 (cloud-free)
// Input: raw text (recent buffer or command output)
// Output: up to 3–5 simple bullets derived via regex/rules

function clampText(s = "", max = 4000) {
  const str = String(s);
  if (str.length <= max) return str;
  return str.slice(str.length - max);
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function getErrorBullets(lines) {
  const bullets = [];
  const errRx =
    /(error|failed|failure|exception|traceback|segmentation fault|panic:|unable to)/i;
  for (const l of lines) {
    if (errRx.test(l)) bullets.push(`Error: ${l.trim().slice(0, 180)}`);
    if (bullets.length >= 2) break;
  }
  return bullets;
}

function collectFilesAndChanges(lines) {
  const bullets = [];
  const files = [];
  const fileRx =
    /\b([\w./-]+\.(?:js|ts|tsx|jsx|json|md|css|scss|html|py|rb|go|java|rs|kt|sh|yml|yaml|toml))\b/g;
  const changedRx = /(added|modified|changed|created|deleted|renamed)/i;
  for (const l of lines) {
    let m = fileRx.exec(l);
    while (m) {
      files.push(m[1]);
      m = fileRx.exec(l);
    }
    if (changedRx.test(l)) bullets.push(`Change: ${l.trim().slice(0, 160)}`);
    if (bullets.length >= 2) break;
  }
  return { bullets, files: unique(files) };
}

function getDurationBullet(lines) {
  const durRx = /\b(\d+(?:\.\d+)?)(ms|s|sec|seconds|min|minutes|h|hours)\b/gi;
  const durations = [];
  for (const l of lines) {
    let m = durRx.exec(l);
    while (m) {
      durations.push(`${m[1]}${m[2]}`);
      m = durRx.exec(l);
    }
    if (durations.length > 6) break;
  }
  if (durations.length) {
    return `Durations seen: ${unique(durations).slice(0, 4).join(", ")}`;
  }
  return null;
}

function getTestBullet(lines) {
  const testRx =
    /(tests?|specs?)\b.*\b(pass|passed|fail|failed|skipped|todo)\b/i;
  const t = lines.find((l) => testRx.test(l));
  return t ? `Tests: ${t.trim().slice(0, 160)}` : null;
}

export function summarize(rawText) {
  const text = clampText(rawText, 8000);
  const lines = text.split(/\r?\n/);
  const recent = lines.slice(-500);
  const bullets = [];

  bullets.push(...getErrorBullets(recent));

  const changes = collectFilesAndChanges(recent.slice(-200));
  bullets.push(...changes.bullets);
  if (bullets.length < 5 && changes.files.length) {
    bullets.push(`Files mentioned: ${changes.files.slice(0, 5).join(", ")}`);
  }

  if (bullets.length < 5) {
    const d = getDurationBullet(recent.slice(-200));
    if (d) bullets.push(d);
  }

  if (bullets.length < 5) {
    const t = getTestBullet(recent);
    if (t) bullets.push(t);
  }

  if (bullets.length === 0) {
    bullets.push(`Output: ${recent.length} line(s), showing recent activity.`);
  }

  return { bullets: bullets.slice(0, 5) };
}

export function summarizeIfChanged(text, lastHash) {
  const s = String(text || "");
  const hash = simpleHash(s);
  if (hash === lastHash) return { changed: false, hash, summary: null };
  return { changed: true, hash, summary: summarize(s) };
}

function simpleHash(s) {
  // Lightweight non-cryptographic hash for change detection
  let h = 0;
  for (let i = Math.max(0, s.length - 5000); i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}
