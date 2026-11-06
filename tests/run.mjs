// ルール層の回帰テスト: node tests/run.mjs
// cases.json の各例について、ルールのみの判定（AIなし）が expect と一致するかを確認する。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { regexScan, ruleRewrite } from "../rules.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const WEAK = new Set(["年齢", "月齢", "日付（年月）", "相対的な時期", "都道府県のみ", "都道府県名（接尾辞なし）", "指定難病（患者数多）", "稀少・届出疾患", "家族構成", "特異な記述（経過）"]);
const order = { ok: 0, caution: 1, danger: 2, none: 0 };

function verdict(text) {
  const { hits, combo } = regexScan(text);
  const strong = hits.filter((h) => !WEAK.has(h.type));
  let v = hits.some((h) => h.severity === "high") ? "danger" : strong.length ? "caution" : "ok";
  if (order[combo.level] > order[v]) v = combo.level;
  return { v, hits, combo };
}

let fail = 0;
for (const c of cases) {
  const { v, hits, combo } = verdict(c.text);
  const rw = ruleRewrite(c.text).text;
  const okV = v === c.expect;
  const okRw = !c.rewrite_contains || c.rewrite_contains.every((s) => rw.includes(s));
  const okNot = !c.rewrite_excludes || c.rewrite_excludes.every((s) => !rw.includes(s));
  if (!okV || !okRw || !okNot) {
    fail++;
    console.log(`✗ ${c.text}`);
    if (!okV) console.log(`   verdict: got ${v}, expect ${c.expect} | hits: ${hits.map((h) => h.type).join(",")} | combo: ${combo.factors.join("+")}`);
    if (!okRw || !okNot) console.log(`   rewrite: ${rw}`);
  }
}
console.log(`${cases.length - fail}/${cases.length} passed${c_note(cases)}`);
if (fail) process.exit(1);
function c_note(cs) { const n = cs.filter((c) => c.needs_ai).length; return n ? `（うち ${n} 件は AI抽出が前提のため、ルール単体の期待値で判定）` : ""; }
