// ルール層 — 機械検出と決定論的な書き換え。どの端末でも瞬時に動き、結果が再現できる。

const NUM = "[0-9０-９]";
const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 検出パターン: [種別, 正規表現, 重大度, 置換（null なら削除しない）, 根拠]
export const PATTERNS = [
  ["マイナンバー（個人番号）", /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, "high", "（個人番号削除）", "法2条2項 個人識別符号"],
  ["クレジットカード番号", /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, "high", "（カード番号削除）", "法2条1項"],
  ["電話番号", /(?<!\d)0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}(?!\d)/g, "high", "（電話番号削除）", "法2条1項 連絡先"],
  ["メールアドレス", /[\w.+-]+@[\w-]+\.[\w.-]+/g, "high", "（メール削除）", "法2条1項 連絡先"],
  ["保険証・被保険者番号", /(保険証|被保険者)\s*(番号|記号)?\s*[:：]?\s*[\w-]{4,}/g, "high", "（保険証番号削除）", "法2条2項 個人識別符号"],
  ["患者ID・カルテ番号", /(患者\s*ID|カルテ\s*(番号|No\.?)|ID|番号)\s*[:：]?\s*\d{5,}/g, "high", "（ID削除）", "学会指針1・7"],
  ["郵便番号", /(?<![\d-])〒?\d{3}-\d{4}(?![\d-])/g, "medium", "（郵便番号削除）", "法2条1項 住所"],
  ["住所", /(北海道|東京都|(?:京都|大阪)府|[一-龥]{2,3}県)[一-龥]{1,6}?(市|区|町|村|郡)(?:[一-龥]{1,6}(?:区|町|村))?(?:[一-龥]{1,6}?(?:丁目|\d))?[\d\-－‐丁目番地号]{0,20}/g, "high", "（地域削除）", "学会指針2 住所は記載しない"],
  ["都道府県のみ", /(?<![一-龥])(北海道|東京都|(?:京都|大阪)府|[一-龥]{2,3}県)(?![一-龥]{1,6}(市|区|町|村|郡))(?![一-龥])/g, "low", null, "学会指針2（病態に関係する場合のみ県まで可）"],
  ["相対的な時期", /(一昨日|昨日|今日|本日|今朝|昨夜|今週|先週|今月|先月)/g, "low", "先日", "容易照合性（書き手の勤務日と照合可能）"],
  ["生年月日", /(19|20)\d{2}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?\s*(生まれ|生)/g, "high", "（生年月日削除）", "法2条1項"],
  ["日付（年月日）", /(19|20)\d{2}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?/g, "medium", "某日", "学会指針3 日付は年月まで"],
  ["日付（年月）", /(19|20)\d{2}\s*年\s*\d{1,2}\s*月(?!\d)/g, "low", "某年某月", "学会指針3"],
  ["氏名（敬称付き）", /([一-龥]{1,3})\s?([一-龥]{1,3})\s*(さん|様|氏|君|ちゃん|くん)/g, "high", "患者", "学会指針1 氏名・呼び名は記載しない"],
  ["イニシャル", /(?<![A-Za-z])[A-Z]\.\s?[A-Z]\.(?![A-Za-z])/g, "medium", "患者", "学会指針1 イニシャル不可"],
  ["施設名", /[一-龥ァ-ヶー]{2,10}(大学(?:医学部)?附属病院|大学病院|総合病院|医療センター|こども病院|小児病院|病院|クリニック|医院|診療所)/g, "medium", "某施設", "学会指針5 施設名は記載しない"],
  ["自施設の表現", /(当院|本院|当科|当センター|弊院)/g, "low", "一般病院", "容易照合性（書き手の施設が分かる）"],
  ["学校・園名", /[一-龥ァ-ヶー]{2,10}(小学校|中学校|高校|高等学校|保育園|幼稚園|こども園)/g, "medium", "学校", "組合せによる特定"],
  ["月齢", /生後\s*(\d{1,2})\s*(か月|ヶ月|カ月|ヵ月|日)/g, "medium", null, "小児：月齢は強い識別子"],
  ["年齢", /(?<![\d.])(\d{1,3})\s*歳/g, "medium", null, "容易照合性"],
];

export const SENSITIVE_WORDS = [
  "病名", "診断", "既往", "障害", "精神", "HIV", "遺伝", "犯罪", "前科",
  "宗教", "信条", "人種", "国籍", "妊娠", "中絶", "生活保護", "虐待", "ゲノム", "変異", "バリアント",
];

// 年齢 → 年代
export function ageBand(n) {
  if (n >= 100) return "100歳以上";
  if (n < 1) return "乳児";
  if (n <= 5) return "幼児";
  if (n <= 12) return "学童";
  if (n <= 18) return "思春期";
  if (n < 20) return "10代後半";
  return `${Math.floor(n / 10) * 10}代`;
}

export function regexScan(raw) {
  const text = toHalf(raw);
  const hits = [];
  for (const [type, re, severity, , basis] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const s = m[0];
      hits.push({ type, severity, basis, excerpt: s.length > 8 ? s.slice(0, 4) + "…" + s.slice(-2) : s });
    }
  }
  const keywords = SENSITIVE_WORDS.filter((w) => text.includes(w));
  return { hits, keywords };
}

// 決定論的な書き換え。changes に before/after/reason を残す。
export function ruleRewrite(raw) {
  let text = toHalf(raw);
  const changes = [];
  const notes = [];
  const rec = (before, after, reason) => { if (before !== after) changes.push({ before, after, reason }); };

  for (const [type, re, , repl, basis] of PATTERNS) {
    re.lastIndex = 0;
    if (type === "年齢") {
      text = text.replace(re, (m, n) => {
        const v = parseInt(n, 10), band = ageBand(v);
        const after = v >= 100 ? `${band}（特異な記述：同意または倫理委員会の要否を検討）` : `${band}期`.replace("代期", "代").replace("100歳以上期", "100歳以上");
        rec(m, after, `年齢は年代に一般化（${basis}）${v >= 100 ? "。極端な年齢は匿名加工情報の「特異な記述」に当たるため、一般化しても特定されうる" : ""}`);
        if (v >= 100) notes.push("極端な年齢（特異な記述）を含みます。一般化後も本人同意または倫理委員会承認の要否を検討してください。");
        return after;
      });
      continue;
    }
    if (type === "月齢") {
      text = text.replace(re, (m) => { rec(m, "乳児期", `月齢は「乳児期」に一般化（${basis}）`); return "乳児期"; });
      continue;
    }
    if (repl == null) continue;
    text = text.replace(re, (m) => { rec(m, repl, `${type}：${basis}`); return repl; });
  }
  // 重複する変更をまとめる
  const seen = new Set();
  const uniq = changes.filter((c) => { const k = c.before + "→" + c.after; if (seen.has(k)) return false; seen.add(k); return true; });
  return { text, changes: uniq, notes };
}
