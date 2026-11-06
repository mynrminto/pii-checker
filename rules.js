// ルール層 — 機械検出と決定論的な書き換え。どの端末でも瞬時に動き、結果が再現できる。
import { findDiseases } from "./diseases.js?v=29";
import { SURNAMES } from "./surnames.js?v=29";

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
  ["住所（番地）", /(?<![一-龥])[一-龥]{1,6}(市|区|町|村)[一-龥]{0,10}?\d{1,4}[-－‐]\d{1,4}(?:[-－‐]\d{1,4})?/g, "high", "（地域削除）", "学会指針2 住所は記載しない"],
  ["住所", /(北海道|東京都|(?:京都|大阪)府|[一-龥]{2,3}県)[一-龥]{1,6}?(市|区|町|村|郡)(?:[一-龥]{1,6}(?:区|町|村))?(?:[一-龥]{1,6}?(?:丁目|\d))?[\d\-－‐丁目番地号]{0,20}/g, "high", "（地域削除）", "学会指針2 住所は記載しない。感染地・環境曝露が病態に関係する場合は都道府県までは記載可"],
  ["都道府県のみ", /(?<![一-龥])(北海道|東京都|(?:京都|大阪)府|[一-龥]{2,3}県)(?![一-龥]{1,6}(市|区|町|村|郡))(?![一-龥])|(東京都|(?:京都|大阪)府|[一-龥]{2,3}県)(?=内|在住|出身)/g, "low", null, "学会指針2（病態に関係する場合のみ県まで可）"],
  ["都道府県名（接尾辞なし）", /(?<![一-龥])(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)(?![一-龥])/g, "low", null, "学会指針2（病態に関係する場合のみ都道府県まで可）"],
  ["主要都市名（接尾辞なし）", /(?<![一-龥])(札幌|仙台|さいたま|横浜|川崎市|名古屋|神戸|堺|北九州|福岡市|広島市|京都市|大阪市|新潟市|浜松|静岡市|相模原|岡山市|熊本市|那覇|金沢|松山|高松|宇都宮|盛岡|長崎市|鹿児島市)(?![一-龥])/g, "medium", "（地名削除）", "学会指針2 住所は記載しない"],
  ["相対的な時期", /(一昨日|昨日|今日|本日|今朝|昨夜|今週|先週|今月|先月)/g, "low", "先日", "容易照合性（書き手の勤務日と照合可能）"],
  ["生年月日", /(19|20)\d{2}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?\s*(生まれ|生)/g, "high", "（生年月日削除）", "法2条1項"],
  ["日付（年月日）", /(19|20)\d{2}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?/g, "medium", "某日", "学会指針3 日付は年月まで"],
  ["日付（年月）", /(19|20)\d{2}\s*年\s*\d{1,2}\s*月(?!\d)/g, "low", "某年某月", "学会指針3"],
  ["氏名（敬称付き）", /(?!(?:患者|患児|母親|父親|保護者|看護師|医師|先生|皆|利用者|御家族|家族|祖母|祖父|兄|姉|弟|妹|母|父|子ども|お子|赤ちゃん|新生児|乳児)(?:さん|様|氏|君|ちゃん|くん))([一-龥]{1,3})\s?([一-龥]{1,3})\s*(さん|様|氏|君|ちゃん|くん)/g, "high", "患者", "学会指針1 氏名・呼び名は記載しない"],
  ["氏名（カタカナ）", /(?<![ァ-ヶー])[ァ-ヶー]{2,6}[ \u3000・][ァ-ヶー]{2,6}(?:さん|様|氏|君|ちゃん|くん|先生)?(?=\s*(?:、|，|,|。|\d|（|\(|歳|は|が|の|を|に|と|も|へ|$))/g, "high", "患者", "学会指針1 氏名は記載しない（カタカナ姓名）"],
  ["氏名（英字）", /(?<![A-Za-z])(?:Dr\.?\s*|Mr\.?\s*|Ms\.?\s*|Mrs\.?\s*)?[A-Z][a-z]{1,12}(?: [A-Z]\.)? [A-Z][a-z]{1,14}(?![A-Za-z])(?!\s*(?:disease|syndrome|病|症候群|反応|法|分類|スコア|score|test|sign|徴候|基準))/g, "high", "患者", "学会指針1 氏名は記載しない（英字姓名）"],
  ["イニシャル", /(?<![A-Za-z])[A-Z]\.\s?[A-Z]\.(?![A-Za-z])/g, "medium", "患者", "学会指針1 イニシャル不可"],
  ["施設名", /[一-龥ァ-ヶー]{2,10}(大学(?:医学部)?附属病院|大学病院|総合病院|医療センター|こども病院|小児病院|病院|クリニック|医院|診療所)/g, "medium", "某施設", "学会指針5 施設名は記載しない"],
  ["自施設の表現", /(当院|本院|当科|当センター|弊院)/g, "low", "一般病院", "容易照合性（書き手の施設が分かる）"],
  ["学校・園名", /[一-龥ァ-ヶー]{2,10}(小学校|中学校|高校|高等学校|保育園|幼稚園|こども園)/g, "medium", "学校", "組合せによる特定"],
  ["地名", /(?<![一-龥])([一-龥ァ-ヶー]{1,5})(島|半島|市|区|町|村|郡|諸島)(?![立民場街役販中域分別切画])/g, "medium", "（地名削除）", "学会指針2 住所は記載しない（小規模地域は特に）"],
  ["稀少・届出疾患", null, "medium", null, "匿名加工情報編GL 特異な記述／感染症法の届出・公表疾患"],
  ["特異な記述（症例数）", /(国内|本邦|世界|県内|府内|都内|道内|当院|当科|日本)(で|では|初|初めて)?(初|初めて|初例|第?\d+例目|\d+例目|最年少|最高齢|最年長)/g, "medium", null, "匿名加工情報編GL 特異な記述"],
  ["特異な記述（経過）", /(珍しい|稀な|まれな|非典型的な|極めて特異な|異例の|教科書的でない|前例のない)(経過|症例|所見|合併|反応|臨床像)/g, "medium", null, "匿名加工情報編GL 特異な記述"],
  ["特異な記述（極端な数値）", /(身長\s*(?:1[9]\d|2\d\d)\s*cm|身長\s*(?:[1-9]\d|1[0-2]\d)\s*cm(?=.{0,6}(成人|男性|女性))|体重\s*(?:1[2-9]\d|[2-9]\d\d)\s*kg|出生体重\s*(?:[1-4]\d\d|[5-9]\d)\s*g|在胎\s*2[2-4]\s*週|体重\s*[1-2]\d\s*kg(?=.{0,6}(成人|男性|女性)))/g, "medium", null, "匿名加工情報編GL 特異な記述（極端な数値）"],
  ["職業・肩書き", /(父|母|本人|祖父|祖母|保護者|両親|夫|妻|親)(親)?(は|が|の)?\s*(市議会?議員|県議会?議員|町議会?議員|国会議員|議員|市長|町長|村長|知事|首長|社長|会長|理事長|院長|校長|教頭|住職|神主|牧師|アナウンサー|芸能人|俳優|タレント|歌手|プロ野球選手|プロサッカー選手|力士|プロ選手|オリンピック|医師|歯科医師|看護師|薬剤師|教員|教師|教授|警察官|消防士|自衛官|弁護士|裁判官|検事|公務員|パイロット|僧侶|農家|漁師)/g, "medium", null, "組合せによる特定（職業）"],
  ["家族構成", /(双子|三つ子|四つ子|ふたご|みつご|一卵性|二卵性|\d人(兄弟|姉妹|きょうだい)|(兄弟|姉妹|きょうだい)\d人|(第|)\d(子|人目)|末っ子|一人っ子|ひとりっ子|里子|養子|母子家庭|父子家庭|ひとり親|シングルマザー|シングルファーザー)/g, "low", null, "組合せによる特定（家族構成）"],
  ["月齢", /生後\s*(\d{1,2})\s*(か月|ヶ月|カ月|ヵ月|日)/g, "medium", null, "小児：月齢は強い識別子"],
  ["年齢", /(?<![\d.])(\d{1,3})\s*歳/g, "medium", null, "容易照合性"],
];

// 地名として扱わない一般語
const PLACE_STOP = new Set(["当区","同区","各区","全区","他区","本区","一区","二区","三区","四区","五区","新区","旧区","港区","北区","南区","東区","西区","中区","中央区","一島","二島","半島","本町","一町","二町","三町","新町","旧町","一村","二村","新村","旧村","都市", "市販", "市中", "市立", "市民", "市場", "市街", "市内", "市外", "市役", "区域", "区分", "地区", "学区", "区別", "区切", "区画", "区内", "全市", "他市", "当市", "本市", "同市", "各市", "区立", "特別区", "行政区", "病区", "離島", "無人島", "半島", "列島", "諸島", "本島", "全島", "島内", "島外", "小島", "孤島", "町内", "町立", "町民", "村立", "村民", "村落", "郡部", "市町村", "区町村", "町村", "寒村", "農村", "漁村", "山村", "島嶼", "群島", "属島", "周辺島"]);

// ---- 敬称なしの氏名（姓辞書＋後続パターン） ----
const SN = [...new Set(SURNAMES.filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
const SN_RE = new RegExp("(?<![一-龥ァ-ヶ])(" + SN.join("|") + ")", "g");
const ORG_AFTER = /^(病院|医院|小児科|内科|外科|クリニック|診療所|医療センター|大学|市|区|町|村|郡|駅|川|山|橋|通|銀行|製薬|製作所|商店|株式|学校|小学校|中学校|高校|幼稚園|保育園|薬局|薬品|電機|建設|工業|組|屋|家|流|派|式|法|反応|徴候|症候群|病$)/;
const GIVEN = /^[ \u3000]?([一-龥]{1,3}|[ぁ-ん]{2,4}?|[ァ-ヶー]{2,5})/;
const BOUNDARY = /^(さん|様|氏|君|ちゃん|くん|先生|医師|患者|です|ます|でした|と申|は|が|の|を|に|と|も|へ|から|、|。|，|．|\s|$|\d|（|\(|[A-Za-z]|・)/;
export function findNames(text) {
  const out = [];
  for (const m of text.matchAll(SN_RE)) {
    const start = m.index, sur = m[1];
    let rest = text.slice(start + sur.length);
    if (ORG_AFTER.test(rest)) continue;
    let end = start + sur.length, hasGiven = false;
    // 名の候補：漢字1-3（長い順）、カタカナ2-5、ひらがな2-4。境界が続くものを採用
    const sp = rest.match(/^[ \u3000]/) ? 1 : 0;
    const body = rest.slice(sp);
    const cands = [];
    for (const [re, max] of [[/^[一-龥]{1,3}/, 3], [/^[ァ-ヶー]{2,5}/, 5], [/^[ぁ-ん]{2,4}/, 4]]) {
      const mm = body.match(re); if (!mm) continue;
      if (re.source.includes("ぁ-ん")) { for (let L = 2; L <= mm[0].length; L++) cands.push(body.slice(0, L)); }   // ひらがなは短い順（助詞を巻き込まない）
      else { for (let L = mm[0].length; L >= (re.source.includes("一-龥") ? 1 : 2); L--) cands.push(body.slice(0, L)); }
    }
    for (const gv of cands) {
      if (ORG_AFTER.test(gv) || /^(先生|医師|教授|部長|院長|看護師|薬剤師|技師|主任|係長|課長)$/.test(gv)) continue;
      if (/^(です|ます|でし|だっ|だと|から|まで|より|こと|もの|など|とか|では|には|とは|にて|への)/.test(gv)) continue;
      if (BOUNDARY.test(body.slice(gv.length))) { end += sp + gv.length; hasGiven = true; rest = body.slice(gv.length); break; }
    }
    if (!hasGiven && !BOUNDARY.test(rest)) continue;
    // 姓のみ＋助詞は弱め（「佐藤は」）。姓＋名、または敬称付きは強め
    const honor = /^(さん|様|氏|君|ちゃん|くん|先生|医師)/.test(rest);
    out.push({ start, end, text: text.slice(start, end), strong: hasGiven || honor });
  }
  // 重なりを除去（長い方を優先）
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const res = []; let last = -1;
  for (const o of out) { if (o.start >= last) { res.push(o); last = o.end; } }
  return res;
}

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
    if (!re) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const s = m[0];
      if (type === "地名" && PLACE_STOP.has(s)) continue;
      hits.push({ type, severity, basis, raw: s, excerpt: s.length > 8 ? s.slice(0, 4) + "…" + s.slice(-2) : s });
    }
  }
  // 住所として検出済みの文字列に含まれる地名は重複なので落とす
  const addr = hits.filter((h) => h.type === "住所" || h.type === "住所（番地）").map((h) => h.raw);
  for (let i = hits.length - 1; i >= 0; i--) if (hits[i].type === "地名" && addr.some((a) => a.includes(hits[i].raw))) hits.splice(i, 1);
  for (const n of findNames(text)) hits.push({ type: n.strong ? "氏名" : "姓のみ", severity: n.strong ? "high" : "medium", basis: "学会指針1 氏名は記載しない", excerpt: n.text });
  for (const d of findDiseases(text)) hits.push({ type: d.severity === "low" ? "指定難病（患者数多）" : "稀少・届出疾患", severity: d.severity, basis: `${d.group}：匿名加工情報編GL「特異な記述」`, excerpt: d.name });
  const keywords = SENSITIVE_WORDS.filter((w) => text.includes(w));
  return { hits, keywords, combo: comboRisk(hits, text) };
}

// 組合せによる再識別リスク（準識別子の数で評価）
export function comboRisk(hits, text) {
  const has = (t) => hits.some((h) => h.type === t);
  const q = [];
  if (has("年齢") || has("月齢")) q.push("年齢");
  if (hits.some((h) => h.type === "年齢" && parseInt(h.excerpt, 10) >= 100)) q.push("極端な年齢");
  if (has("住所") || has("地名") || has("主要都市名（接尾辞なし）")) q.push("地域"); else if (has("都道府県のみ") || has("都道府県名（接尾辞なし）")) q.push("都道府県");
  if (has("稀少・届出疾患")) q.push("稀少・届出疾患");
  if (has("日付（年月日）") || has("日付（年月）") || has("相対的な時期")) q.push("時期");
  if (has("施設名") || has("自施設の表現")) q.push("施設");
  if (has("学校・園名")) q.push("学校");
  if (has("特異な記述（症例数）") || has("特異な記述（極端な数値）") || has("特異な記述（経過）")) q.push("特異な記述");
  if (has("職業・肩書き")) q.push("職業");
  if (has("家族構成")) q.push("家族構成");
  if (/(男性|女性|男児|女児|男の子|女の子)/.test(text)) q.push("性別");
  let level = "none";
  const n = q.length;
  const strong = (q.includes("稀少・届出疾患") || q.includes("特異な記述")) && q.includes("地域");
  if (q.includes("特異な記述") && (q.includes("職業") || q.includes("家族構成") || q.includes("地域") || q.includes("時期") || q.includes("稀少・届出疾患"))) return { level: "danger", factors: q };
  if (q.includes("職業") && (q.includes("地域") || q.includes("都道府県") || q.includes("稀少・届出疾患"))) return { level: "danger", factors: q };
  if (q.includes("職業")) return { level: "caution", factors: q };
  if (strong && (q.includes("極端な年齢") || q.includes("時期") || q.includes("年齢"))) level = "danger";
  else if (q.includes("稀少・届出疾患") && q.includes("都道府県") && (q.includes("年齢") || q.includes("時期"))) level = "danger";
  else if (strong || n >= 3) level = "caution";
  else if (q.includes("稀少・届出疾患") && q.includes("都道府県")) level = "caution";
  else if (q.includes("特異な記述") && (q.includes("都道府県") || q.includes("時期") || q.includes("施設"))) level = "caution";
  else if (n === 2 && !q.includes("性別")) level = "caution";
  return { level, factors: q };
}

// 決定論的な書き換え。changes に before/after/reason を残す。
export function ruleRewrite(raw, extra = []) {
  let text = toHalf(raw);
  const changes = [];
  const notes = [];
  const rec = (before, after, reason) => { if (before !== after) changes.push({ before, after, reason }); };
  // AI等が抽出した追加スパン（本文に実在するものだけ）を先に置換。長いものから
  for (const e of [...extra].sort((a, b) => b.text.length - a.text.length)) {
    const w = toHalf(e.text);
    if (!w || !text.includes(w)) continue;
    text = text.split(w).join(e.after);
    rec(w, e.after, e.reason);
  }

  // 日付が2つ以上あれば、最初の日付を基準日にして間隔を保った相対表記にする（経過の情報を残す）
  {
    const dre = /(?<!\d)((?:19|20)\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})(?!\s*日?\s*(?:生まれ|生))\s*日?/g;
    const found = [...text.matchAll(dre)].map((m) => ({ s: m[0], d: Date.UTC(+m[1], +m[2] - 1, +m[3]) })).filter((x) => !isNaN(x.d));
    if (found.length >= 2) {
      const base = Math.min(...found.map((x) => x.d));
      text = text.replace(dre, (m, y, mo, d) => {
        const n = Math.round((Date.UTC(+y, +mo - 1, +d) - base) / 86400000);
        const after = n === 0 ? "基準日" : `基準日＋${n}日`;
        rec(m, after, "日付は間隔を保った相対表記に（学会指針3）。経過の情報は残し、暦日だけを消す");
        return after;
      });
    }
  }
  // 敬称なしの氏名（姓辞書）→ 患者。後ろから置換して位置ずれを防ぐ
  for (const n of findNames(text).reverse()) {
    const tail = text.slice(n.end), head = text.slice(0, n.start);
    const honor = tail.match(/^(さん|様|氏|君|ちゃん|くん|先生|医師)/);
    const cut = honor ? honor[0].length : 0;
    let after = "患者";
    if (honor && /先生|医師/.test(honor[0])) after = "担当医";
    else if (/(私|わたし|僕|担当は|主治医は|担当医は|執刀は)[、,，は ]*$/.test(head) || /^(です|と申します|が担当|が主治医)/.test(tail.slice(cut))) after = "某医師";
    else if (/^[ \u3000]*(が|は|も)?(担当|主治|医師|先生|教授|看護|薬剤師|技師)/.test(tail.slice(cut))) after = "某医師";
    else if (/(患者|患児|母|父|保護者|祖母|祖父|兄|姉|弟|妹)[ \u3000]*$/.test(head)) after = "";
    text = head.replace(/[ \u3000]+$/, after ? "$&" : "") + after + text.slice(n.end + cut);
    rec(n.text + (honor ? honor[0] : ""), after || "（削除）", "氏名：学会指針1 氏名・呼び名は記載しない");
  }
  for (const [type, re, , repl, basis] of PATTERNS) {
    if (!re) continue;
    re.lastIndex = 0;
    if (type === "地名") {
      text = text.replace(re, (m) => { if (PLACE_STOP.has(m)) return m; rec(m, "（地名削除）", `地名：${basis}。感染地など病態に関係する場合は都道府県までに留める`); return "（地名削除）"; });
      continue;
    }
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
    if (type === "氏名（カタカナ）" || type === "氏名（英字）") {
      text = text.replace(re, (m) => { const doc = /^(Dr|Mr|Ms|Mrs)\.?\s|先生$/.test(m); const after = doc ? "担当医" : "患者"; rec(m, after, `${type}：${basis}`); return after; });
      continue;
    }
    if (type === "職業・肩書き") {
      text = text.replace(re, (m, rel, oya) => { const after = `${rel}${oya || ""}（職業削除）`; rec(m, after, `職業・肩書きは識別に直結するため削除（${basis}）。診療上不可欠なら一般化して戻す`); return after; });
      continue;
    }
    if (repl == null) continue;
    text = text.replace(re, (m) => { rec(m, repl, `${type}：${basis}`); return repl; });
  }
  if (/(国内|本邦|世界|県内|府内|都内|道内|当院|当科|日本)(で|では)?(初|初めて|初例|第?\d+例目|\d+例目|最年少|最高齢|最年長)/.test(text)) notes.push("「国内○例目」「県内初」などの症例数・順位は匿名加工情報の「特異な記述」です。「極めて稀な」「報告例が少ない」に言い換えるか、同意または倫理委員会承認の要否を検討してください。");
  if (/(父|母|本人|祖父|祖母|保護者|両親|夫|妻|親)(親)?(は|が|の)?\s*[一-龥]{0,4}(議員|市長|町長|村長|知事|社長|会長|理事長|院長|校長|芸能人|俳優|タレント|歌手|力士|プロ|アナウンサー|医師|教員|教師|警察官|弁護士)/.test(text)) notes.push("家族や本人の職業・肩書きは、地域や疾患と組み合わさると強い識別子になります。診療上不可欠でなければ削除してください。");
  if (/(珍しい|稀な|まれな|非典型的な|極めて特異な|異例の|教科書的でない|前例のない)(経過|症例|所見|合併|反応|臨床像)/.test(text)) notes.push("「珍しい経過」「非典型的な所見」のような記述は、地域・時期・施設と組み合わさると症例が特定されます。具体的に何が稀なのかは残し、場所と時期を削るか、同意または倫理委員会承認の要否を検討してください。");
  if (/(身長\s*(?:1[9]\d|2\d\d)\s*cm|体重\s*(?:1[2-9]\d|[2-9]\d\d)\s*kg|出生体重\s*(?:[1-4]\d\d|[5-9]\d)\s*g|在胎\s*2[2-4]\s*週)/.test(text)) notes.push("極端な数値（身長・体重・在胎週数など）は匿名加工情報の「特異な記述」になりえます。幅のある表現（「超低出生体重児」「極端な高身長」）に置き換えることを検討してください。");
  if (/(双子|三つ子|ふたご|みつご|\d人(兄弟|姉妹|きょうだい)|母子家庭|父子家庭|ひとり親|里子|養子)/.test(text)) notes.push("家族構成（多胎、きょうだいの人数、養育環境）は地域と組み合わさると特定につながります。診療上必要な範囲に留めてください。");
  for (const d of findDiseases(text)) {
    if (d.severity === "low") notes.push(`「${d.name}」は指定難病ですが患者数が多く、単独では特異な記述になりにくい疾患です。小規模な地域名や正確な年齢・時期と組み合わせないよう注意してください。`);
    else notes.push(`「${d.name}」（${d.group}）は匿名加工情報の「特異な記述」に当たりえます。疾患名そのものは残して構いませんが、地域・正確な年齢・時期・施設を一緒に書かないでください。症例報告として出す場合は同意または倫理委員会承認の要否を検討してください。`);
  }
  // 置換で生じた不自然な助詞を整える
  text = text.replace(/（地域削除）の/g, "").replace(/（地名削除）で/g, "（地名削除）で").replace(/にの/g, "に").replace(/\s+（電話番号削除）/g, "（電話番号削除）");
  // 重複する変更をまとめる
  const seen = new Set();
  const uniq = changes.filter((c) => { const k = c.before + "→" + c.after; if (seen.has(k)) return false; seen.add(k); return true; });
  return { text, changes: uniq, notes };
}
