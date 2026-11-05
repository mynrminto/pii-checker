import { regexScan } from "./rules.js";
import { loadCorpus } from "./rag.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const VL = { ok: "入力して問題なし", caution: "注意（文脈次第で特定されうる）", danger: "入力不可（個人情報／要配慮情報を含む）" };

const MODELS = {
  small: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",   // 約1GB
  medium: "Qwen2.5-3B-Instruct-q4f16_1-MLC",    // 約2GB
};

const SYSTEM = `あなたは日本の個人情報保護法および医療分野ガイダンスに基づいて、
テキストを外部サービス（クラウドAI、SNS、公開Webページ等）へ入力してよいかを判定する審査員です。
必ず以下のJSONのみを出力してください（前後に説明文を付けない）。
{"verdict":"danger|caution|ok","summary":"1〜2文の総合判定",
 "findings":[{"category":"個人情報|要配慮個人情報|個人識別符号|第三者の情報|該当なし","reason":"根拠（参照資料に基づく）","advice":"どう直せば入力可能になるか"}],
 "rewritten":"個人が特定できないよう書き換えた全文。元の文章の意味・医学的内容・構成はできる限り保つ。verdictがokなら原文をそのまま入れる",
 "changes":[{"before":"書き換え前の語句","after":"書き換え後の語句","reason":"なぜ変えたか（根拠）"}],
 "references":["参照した資料名"]}
判定基準:
- danger: 特定の個人を識別できる情報（氏名＋属性、個人識別符号、連絡先）や要配慮個人情報（病歴・診断等）が含まれる
- caution: 単独では識別できないが、組み合わせや文脈で特定されうる情報（年齢・性別・地域・職業・稀な疾患など）
- ok: 個人を識別しうる情報が含まれない
書き換え（rewritten）のルール:
- 氏名・イニシャル・ID・連絡先・個人識別符号は削除（必要なら「患者」「A氏」などの記号に置換）
- 年齢は年代に（例: 5歳→幼児期、47歳→40代）。乳児で月齢が医学的に重要なら「生後数か月」程度に
- 日付は相対表記に（例: 2024年3月10日入院→入院日、入院から3日目）
- 住所・施設名は都道府県以下を削除。所属・職業は診療上必要な範囲に一般化
- 稀な疾患・極端な数値・特異な経過は一般化するか、同意が必要である旨を reason に書く
- 医学的内容（症状、検査値の意味、治療、経過の論理）は変えない
- 変更した箇所はすべて changes に列挙し、理由を資料に基づいて説明する
医療者の入力が多いため、具体的かつ実務的に書き換えてください。`;

let corpus = null, engine = null, webllm = null, loadedModel = null;

// ---------- 通信モニタ（判定中にネットワーク要求が起きていないことを可視化） ----------
let judging = false, netHits = [];
new PerformanceObserver((list) => {
  if (!judging) return;
  for (const e of list.getEntries()) {
    const host = new URL(e.name, location.href).host;
    if (host === location.host) continue;             // 自サイトの資料ファイルは除外
    if (e.name.includes("/web-llm") || e.name.includes("mlc") || e.name.includes("huggingface")) continue; // モデルの初回取得
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
    $("#gpu").innerHTML = "このブラウザは WebGPU 非対応のため、AI判定は使えません（機械検出と資料検索のみ）。";
    $("#llm").disabled = true;
  } else {
    $("#gpu").textContent = "WebGPU 利用可。初回はモデルをダウンロードします（以後はブラウザにキャッシュ）。";
  }
})();

async function ensureEngine(size) {
  const id = MODELS[size];
  if (engine && loadedModel === id) return engine;
  if (!webllm) webllm = await import("https://esm.run/@mlc-ai/web-llm");
  $("#st").textContent = "モデル読み込み中…";
  engine = await webllm.CreateMLCEngine(id, {
    initProgressCallback: (p) => { $("#st").textContent = p.text; },
  });
  loadedModel = id;
  return engine;
}

// ---------- 判定 ----------
$("#clr").onclick = () => { $("#t").value = ""; $("#out").innerHTML = ""; $("#st").textContent = ""; };

$("#go").onclick = async () => {
  const text = $("#t").value.trim();
  if (!text) return;
  if (text.length > 6000) { $("#out").innerHTML = `<p class="err">6000文字以内にしてください（長文は分割して判定）</p>`; return; }
  $("#go").disabled = true; $("#out").innerHTML = "";
  if ($("#llm").checked && navigator.gpu) {               // 初回DLは通信監視の対象外にする
    try { await ensureEngine($("#size").value); }
    catch (e) { $("#out").innerHTML = `<p class="err">モデル読み込みに失敗: ${esc(e.message)}。AI判定なしで続行します。</p>`; $("#llm").checked = false; }
  }
  judging = true; netHits = []; $("#netcount").textContent = "0 件"; $("#shield").classList.remove("alert");

  const { hits, keywords } = regexScan(text);
  const ctx = corpus ? corpus.search(text.slice(0, 1500), 3).map((c) => ({ ...c, text: c.text.slice(0, 450) })) : [];
  // 機械検出だけ先に表示
  render({ verdict: hits.some((h) => h.severity === "high") ? "danger" : (hits.length || keywords.length) ? "caution" : "ok",
           summary: "機械検出の結果（AI判定前）", findings: [], references: [], regex_hits: hits, sensitive_keywords: keywords, retrieved: ctx, provisional: true });

  if ($("#llm").checked && navigator.gpu) {
    try {
      const eng = await ensureEngine($("#size").value);
      $("#st").textContent = "AI判定中…";
      const ctxTxt = ctx.map((c) => `【${c.source}】\n${c.text}`).join("\n\n") || "（資料なし）";
      const user = `# 参照資料\n${ctxTxt}\n\n# 機械検出の結果\n${JSON.stringify(hits)}\n要配慮の手がかり語: ${keywords.join(",")}\n\n# 判定対象テキスト\n<<<\n${text}\n>>>`;
      const stream = await eng.chat.completions.create({
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
        temperature: 0.1, max_tokens: 1500, stream: true,
      });
      let out = "", n = 0;
      for await (const chunk of stream) {
        out += chunk.choices[0]?.delta?.content || "";
        if (++n % 5 === 0) $("#st").textContent = `AI判定中… ${n} トークン生成`;
      }
      let j;
      try { j = extractJson(out); }
      catch { j = { verdict: "caution", summary: "モデル出力の解析に失敗しました。機械検出の結果を参照してください。", findings: [], references: [] }; }
      if (hits.some((h) => h.severity === "high") && j.verdict === "ok") {
        j.verdict = "caution"; j.summary = "機械検出で識別情報らしきものが見つかりました。" + (j.summary || "");
      }
      render({ ...j, regex_hits: hits, sensitive_keywords: keywords, retrieved: ctx });
    } catch (e) {
      $("#out").insertAdjacentHTML("beforeend", `<p class="err">AI判定でエラー: ${esc(e.message)}</p>`);
    }
  }
  judging = false;
  $("#go").disabled = false; $("#st").textContent = "";
};

// モデル出力から JSON 部分だけを取り出す（前後の説明文や ```json フェンス、<think> を除去）
function extractJson(raw) {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(t.slice(a, b + 1));
}

function render(j) {
  const v = ["ok", "caution", "danger"].includes(j.verdict) ? j.verdict : "caution";
  let h = `<div class="card"><span class="verdict v-${v}">${VL[v]}</span>${j.provisional ? '<span class="note"> ※AI判定前の暫定</span>' : ""}<div>${esc(j.summary)}</div>`;
  for (const f of j.findings || []) h += `<div class="finding"><b>${esc(f.category)}</b>${esc(f.reason)}<div class="adv">→ ${esc(f.advice)}</div></div>`;
  h += `</div>`;
  if (j.rewritten && !j.provisional) {
    h += `<div class="card"><b>安全な形に書き換えた案</b>
      <textarea id="rw" readonly>${esc(j.rewritten)}</textarea>
      <div class="row"><button id="cp" class="ghost">コピー</button><span class="note">書き換え後も必ず自分の目で確認してください</span></div>`;
    if (j.changes?.length) {
      h += `<b>変更箇所と理由</b>`;
      for (const c of j.changes) h += `<div class="finding"><span class="before">${esc(c.before)}</span> → <span class="after">${esc(c.after)}</span><div class="note">${esc(c.reason)}</div></div>`;
    }
    h += `</div>`;
  }
  if (j.regex_hits?.length || j.sensitive_keywords?.length) {
    h += `<div class="card"><b>機械検出</b><div>`;
    for (const r of j.regex_hits) h += `<span class="tag ${r.severity}">${esc(r.type)}: ${esc(r.excerpt)}</span>`;
    for (const k of j.sensitive_keywords) h += `<span class="tag">要配慮の手がかり: ${esc(k)}</span>`;
    h += `</div></div>`;
  }
  h += `<details><summary>参照資料</summary><div class="note">${(j.references || []).map(esc).join("、") || "—"}<br>検索ヒット: ${(j.retrieved || []).map((r) => `${esc(r.source)} (${r.score.toFixed(1)})`).join("、") || "—"}</div></details>`;
  $("#out").innerHTML = h;
  const cp = $("#cp");
  if (cp) cp.onclick = async () => { await navigator.clipboard.writeText($("#rw").value); cp.textContent = "コピーしました"; setTimeout(() => (cp.textContent = "コピー"), 1500); };
}
