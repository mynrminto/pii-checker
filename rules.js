// 正規表現層 — どの端末でも即座に動く機械検出
export const PATTERNS = [
  ["マイナンバー（個人番号）", /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, "high"],
  ["電話番号", /(?<!\d)0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}(?!\d)/g, "high"],
  ["メールアドレス", /[\w.+-]+@[\w-]+\.[\w.-]+/g, "high"],
  ["郵便番号", /(?<![\d-])〒?\d{3}-\d{4}(?![\d-])/g, "medium"],
  ["住所（番地まで）", /(都|道|府|県)[^\s、。]{1,20}?(市|区|町|村)[^\s、。]{0,20}?\d+[-－‐]\d+/g, "high"],
  ["生年月日", /(19|20)\d{2}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?\s*(生|生まれ)?/g, "medium"],
  ["年齢＋日付の組合せ", /(\d{1,2})\s*歳[^]{0,40}?(19|20)\d{2}\s*[年/.-]\s*\d{1,2}/g, "medium"],
  ["患者ID・カルテ番号", /(患者|カルテ|ID|番号)\s*[:：]?\s*\d{5,}/g, "high"],
  ["クレジットカード番号", /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, "high"],
  ["氏名らしき表記", /[一-龥]{1,3}\s?[一-龥]{1,3}\s*(さん|様|氏|君|ちゃん|くん)/g, "medium"],
  ["保険証・被保険者番号", /(保険証|被保険者)\s*(番号|記号)?\s*[:：]?\s*[\w-]{4,}/g, "high"],
];

export const SENSITIVE_WORDS = [
  "病名", "診断", "既往", "障害", "精神", "HIV", "遺伝", "犯罪", "前科",
  "宗教", "信条", "人種", "国籍", "妊娠", "中絶", "生活保護",
];

export function regexScan(text) {
  const hits = [];
  for (const [type, re, severity] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const s = m[0];
      hits.push({ type, severity, excerpt: s.length > 6 ? s.slice(0, 3) + "…" + s.slice(-2) : s });
    }
  }
  const keywords = SENSITIVE_WORDS.filter((w) => text.includes(w));
  return { hits, keywords };
}
