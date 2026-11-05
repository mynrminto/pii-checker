import { regexScan, ruleRewrite } from "./rules.js";
import { loadCorpus } from "./rag.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const VL = { ok: "入力して問題なし", caution: "注意（文脈次第で特定されうる）", danger: "入力不可（個人情報／要配慮情報を含む）" };
const MODELS = { small: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", medium: "Qwen2.5-3B-Instruct-q4f16_1-MLC" };

// 判定専用の短いプロンプト（高速化のため、書き換えは頼まない）
const JUDGE_SYSTEM = `あなたは日本の個人情報保護法と医療ガイダンスに基づく審査員。テキストを外部AIやSNSに入力してよいか判定し、JSONだけを返す。
判定: danger=氏名・連絡先・ID・個人識別符号、または個人と結びつく病歴・診断を含む / caution=年齢・性別・地域・日付・施設・稀な疾患などの組合せで特定されうる / ok=個人を識別しうる情報なし
出力例1: {"verdict":"danger","summary":"氏名と診断名が結びついており要配慮個人情報に当たる。","findings":[{"category":"要配慮個人情報","reason":"氏名付きで川崎病の診断が書かれている"},{"category":"個人情報","reason":"保護者の電話番号がある"}]}
出力例2: {"verdict":"ok","summary":"一般的な医学的質問で個人を識別する情報はない。","findings":[]}
summaryは判定対象に即した具体的な1文。categoryは 個人情報／要配慮個人情報／個人識別符号／組合せによる特定 のいずれか1つ。findingsは最大3件。例文をそのまま写さない。`;

// 一般化専用（平文出力。説明や前置きを禁止）
const REWRITE_SYSTEM = `医療文書の匿名化担当者として、与えられた文章を、個人が特定できないよう必要最小限で書き換える。
ルール: 医学的内容（症状・検査・治療・経過の論理）は変えない。残っている年齢・日付・地名・施設・職業・家族構成・稀な特徴を一般化する。既に一般化済みの語はそのまま残す。
出力は書き換え後の文章そのものだけ。説明・前置き・箇条書き・引用符は一切付けない。`;

let corpus = null, engine = null, webllm = null, loadedModel = null;
let lastRuleText = "";

// ---------- 通信モニタ ----------
let judging = false, netHits = [];
new PerformanceObserver((list) => {
  if (!judging) return;
  for (const e of list.getEntries()) {
    const host = new URL(e.name, location.href).host;
    if (host === location.host) continue;
    if (/web-llm|mlc|huggingface/.test(e.name)) continue;
    netHits.push(host);
  }
  $("#netcount").textContent = `${netHits.length} 件`;
  $("#shield").classList.toggle("alert", netHits.length > 0);
}).observe({ type: "resource", buffered: false });
function updateOnline() {
  const off = !navigator.onLine;
  $("#shield").classList.toggle("offline", off);
  $("#online").innerHTML = off ? "現在 <b>オフライン</b>で動作中" : "オフラインでも動作: <b>可</b>（モデル読み込み後）";
}
addEventListener("online", updateOnline); addEventListener("offline", updateOnline); updateOnline();

// ---------- 初期化 ----------
(async () => {
  corpus = await loadCorpus();
  $("#corpus").textContent = `資料チャンク ${corpus.size} 件`;
  if (!navigator.gpu) {
    $("#gpu").innerHTML = "このブラウザは WebGPU 非対応のため AI判定は使えません（ルール判定・書き換えは利用できます）。";
    $("#llm").disabled = true; $("#llm").checked = false;
  } else {
    $("#gpu").textContent = "WebGPU 利用可。AI判定の初回はモデルをダウンロードします（以後はブラウザにキャッシュ）。";
  }
})();

async function ensureEngine() {
  const id = MODELS[$("#size").value];
  if (engine && loadedModel === id) return engine;
  if (!webllm) webllm = await import("https://esm.run/@mlc-ai/web-llm");
  $("#st").textContent = "モデル読み込み中…";
  engine = await webllm.CreateMLCEngine(id, { initProgressCallback: (p) => { $("#st").textContent = p.text; } });
  loadedModel = id;
  return engine;
}

async function chat(system, user, maxTokens, onTok) {
  const eng = await ensureEngine();
  const stream = await eng.chat.completions.create({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.1, max_tokens: maxTokens, stream: true,
  });
  let out = "", n = 0;
  for await (const c of stream) { out += c.choices[0]?.delta?.content || ""; if (++n % 5 === 0) onTok(n); }
  return out;
}
function extractJson(raw) {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(t.slice(a, b + 1));
}

// ---------- 判定 ----------
$("#clr").onclick = () => { $("#t").value = ""; $("#out").innerHTML = ""; $("#st").textContent = ""; };

$("#go").onclick = async () => {
  const text = $("#t").value.trim();
  if (!text) return;
  if (text.length > 6000) { $("#out").innerHTML = `<p class="err">6000文字以内にしてください（長文は分割して判定）</p>`; return; }
  $("#go").disabled = true; $("#out").innerHTML = "";

  // 1) ルール層：検出・書き換え・根拠（即時）
  const { hits, keywords } = regexScan(text);
  const rw = ruleRewrite(text);
  lastRuleText = rw.text;
  const ctx = corpus ? corpus.search(text.slice(0, 1500), 3) : [];
  const ruleVerdict = hits.some((h) => h.severity === "high") ? "danger" : (hits.length || keywords.length) ? "caution" : "ok";
  const state = { verdict: ruleVerdict, summary: ruleSummary(hits, keywords), findings: [], hits, keywords, rw, ctx, ai: null };
  render(state);

  // 2) AI層：短い判定のみ（任意）
  if ($("#llm").checked && navigator.gpu) {
    judging = true; netHits = []; $("#netcount").textContent = "0 件"; $("#shield").classList.remove("alert");
    try {
      await ensureEngine();
      judging = true;
      $("#st").textContent = "AI判定中…";
      const user = `機械検出: ${hits.map((h) => h.type).join("、") || "なし"} / 要配慮の手がかり: ${keywords.join("、") || "なし"}\n\n判定対象:\n${text.slice(0, 2500)}`;
      const raw = await chat(JUDGE_SYSTEM, user, 350, (n) => { $("#st").textContent = `AI判定中… ${n} トークン`; });
      let j;
      try { j = extractJson(raw); } catch { j = { verdict: ruleVerdict, summary: "AI出力を解析できませんでした（ルール判定を表示）", findings: [] }; }
      // 安全側：ルールが danger なら AI の緩い判定で下げない
      const order = { ok: 0, caution: 1, danger: 2 };
      const v = ["ok", "caution", "danger"].includes(j.verdict) ? j.verdict : ruleVerdict;
      state.verdict = order[v] > order[ruleVerdict] ? v : ruleVerdict;
      const bad = (x) => !x || /\|/.test(x) || /^(1文|短く|理由)$/.test(x.trim());
      state.summary = bad(j.summary) ? state.summary : j.summary;
      state.findings = (j.findings || []).filter((f) => !bad(f.category) && !bad(f.reason)).slice(0, 3);
      state.ai = "done";
      render(state);
    } catch (e) {
      state.ai = "error: " + e.message; render(state);
    }
    judging = false;
  }
  $("#go").disabled = false; $("#st").textContent = "";
};

function ruleSummary(hits, kws) {
  const high = hits.filter((h) => h.severity === "high").map((h) => h.type);
  if (high.length) return `直接識別子（${[...new Set(high)].join("、")}）を含みます。下の書き換え案を使ってください。`;
  if (hits.length) return `単独では識別できませんが、${[...new Set(hits.map((h) => h.type))].join("、")}の組合せで特定されうる可能性があります。`;
  if (kws.length) return "識別子は検出されませんでしたが、要配慮情報に関わる語を含みます。個人と結びつく記述がないか確認してください。";
  return "個人を識別しうる情報は検出されませんでした。";
}

// ---------- AI による追加の一般化（任意） ----------
async function aiGeneralize(state) {
  const btn = $("#aigen"); btn.disabled = true;
  try {
    const src = lastRuleText;
    const out = await chat(REWRITE_SYSTEM, src, Math.min(1200, Math.round(src.length * 1.2) + 50), (n) => { $("#st").textContent = `一般化中… ${n} トークン`; });
    const cleaned = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^(書き換え後|出力|結果)[:：]\s*/m, "").trim().replace(/^["「『]|["」』]$/g, "");
    state.aiText = cleaned; state.aiDiff = diffWords(src, cleaned);
    render(state);
  } catch (e) { $("#st").textContent = "一般化でエラー: " + e.message; }
  finally { btn && (btn.disabled = false); $("#st").textContent = ""; }
}

// 簡易差分（文字単位 LCS、短文向け）
function diffWords(a, b) {
  const A = [...a], B = [...b], n = A.length, m = B.length;
  if (n * m > 4e6) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(["=", A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(["-", A[i]]); i++; }
    else { out.push(["+", B[j]]); j++; }
  }
  while (i < n) out.push(["-", A[i++]]); while (j < m) out.push(["+", B[j++]]);
  // 連続をまとめる
  const merged = []; for (const [t, c] of out) { if (merged.length && merged[merged.length - 1][0] === t) merged[merged.length - 1][1] += c; else merged.push([t, c]); }
  return merged;
}

// ---------- 描画 ----------
function render(s) {
  const v = s.verdict;
  let h = `<div class="card"><span class="verdict v-${v}">${VL[v]}</span>`;
  if (s.ai === null && $("#llm").checked && navigator.gpu) h += `<span class="note"> ルール判定（AI判定を実行中）</span>`;
  else if (s.ai && s.ai.startsWith("error")) h += `<span class="note err"> AI判定失敗: ${esc(s.ai.slice(7))}（ルール判定を表示）</span>`;
  h += `<div>${esc(s.summary)}</div>`;
  for (const f of s.findings) h += `<div class="finding"><b>${esc(f.category)}</b>${esc(f.reason)}</div>`;
  h += `</div>`;

  if (s.rw.changes.length) {
    h += `<div class="card"><b>安全な形に書き換えた案</b>
      <textarea id="rw" readonly>${esc(s.rw.text)}</textarea>
      <div class="row"><button id="cp" class="ghost" data-src="rw">コピー</button>`;
    if (navigator.gpu) h += `<button id="aigen" class="ghost">AIでさらに一般化（任意）</button>`;
    h += `<span class="note">書き換え後も必ず自分の目で確認してください</span></div>`;
    for (const n of s.rw.notes) h += `<div class="warn-inline">⚠ ${esc(n)}</div>`;
    h += `<b>変更箇所と理由</b>`;
    for (const c of s.rw.changes) h += `<div class="finding"><span class="before">${esc(c.before)}</span> → <span class="after">${esc(c.after)}</span><div class="note">${esc(c.reason)}</div></div>`;
    h += `</div>`;
  } else if (s.verdict !== "ok") {
    h += `<div class="card"><b>書き換え案</b><div class="note">ルールで置換できる直接識別子はありませんでした。年齢・地域・時期・稀な特徴の組合せを見直してください。</div>`;
    if (navigator.gpu) h += `<div class="row"><button id="aigen" class="ghost">AIで一般化案を作る（任意）</button></div>`;
    h += `</div>`;
  }

  if (s.aiText) {
    h += `<div class="card"><b>AIによる一般化案</b><span class="note">（ルール書き換え文を元に小型モデルが生成。医学的内容が変わっていないか必ず確認）</span>
      <textarea id="ai" readonly>${esc(s.aiText)}</textarea>
      <div class="row"><button class="ghost cp2" data-src="ai">コピー</button></div>`;
    if (s.aiDiff) h += `<div class="diff">` + s.aiDiff.map(([t, c]) => t === "=" ? esc(c) : t === "-" ? `<span class="before">${esc(c)}</span>` : `<span class="after">${esc(c)}</span>`).join("") + `</div>`;
    h += `</div>`;
  }

  if (s.hits.length || s.keywords.length) {
    h += `<div class="card"><b>機械検出</b><div>`;
    for (const r of s.hits) h += `<span class="tag ${r.severity}">${esc(r.type)}: ${esc(r.excerpt)}</span>`;
    for (const k of s.keywords) h += `<span class="tag">要配慮の手がかり: ${esc(k)}</span>`;
    h += `</div></div>`;
  }
  h += `<details><summary>参照資料（関連する節）</summary><div class="note">` +
    (s.ctx.map((c) => `<p><b>${esc(c.source)}</b><br>${esc(c.text.slice(0, 220))}…</p>`).join("") || "—") + `</div></details>`;
  $("#out").innerHTML = h;

  for (const b of document.querySelectorAll("#cp, .cp2")) b.onclick = async () => {
    const ta = $("#" + b.dataset.src); ta.select();
    try { await navigator.clipboard.writeText(ta.value); } catch { document.execCommand("copy"); }
    b.textContent = "コピーしました"; setTimeout(() => (b.textContent = "コピー"), 1500);
  };
  const g = $("#aigen"); if (g) g.onclick = () => aiGeneralize(s);
}
