// RAG 層 — 文字バイグラム BM25。埋め込みモデルのダウンロード不要で全端末で動く
const K1 = 1.2, B = 0.75;

function bigrams(s) {
  const t = s.replace(/[\s、。「」（）()【】・\-ー—]/g, "");
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

export async function loadCorpus(base = "docs/") {
  const files = await (await fetch(base + "index.json")).json();
  const chunks = [];
  for (const f of files) {
    const body = await (await fetch(base + f)).text();
    const source = (body.match(/^#\s+(.+)$/m) || [, f])[1].trim();
    for (const sec of body.split(/\n(?=#{1,3} )/)) {
      const s = sec.trim();
      if (s.length < 40) continue;
      for (let i = 0; i < s.length; i += 600) chunks.push({ source, text: s.slice(i, i + 700) });
    }
  }
  return buildIndex(chunks);
}

function buildIndex(chunks) {
  const df = new Map();
  const docs = chunks.map((c) => {
    const tf = new Map();
    const bg = bigrams(c.text);
    for (const g of bg) tf.set(g, (tf.get(g) || 0) + 1);
    for (const g of tf.keys()) df.set(g, (df.get(g) || 0) + 1);
    return { ...c, tf, len: bg.length };
  });
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(docs.length, 1);
  const N = docs.length;
  return {
    size: N,
    search(query, k = 4) {
      const q = [...new Set(bigrams(query))];
      const scored = docs.map((d) => {
        let s = 0;
        for (const g of q) {
          const f = d.tf.get(g);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(g) + 0.5) / (df.get(g) + 0.5));
          s += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / avg));
        }
        return { source: d.source, text: d.text, score: s };
      });
      return scored.sort((a, b) => b.score - a.score).slice(0, k).filter((d) => d.score > 0);
    },
  };
}
