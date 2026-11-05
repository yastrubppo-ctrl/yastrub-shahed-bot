// БОТ ПУСКІВ БпЛА: розбір новин DIMAP (укр + рос, з помилками і змішаними розкладками).
// Подія: { kind:'drone', key, site:{id,name,region}, groups, jet, droneType, note }

export const BOT_NAME = 'Пуски БпЛА';

// ── Майданчики пусків (id збігаються з shahedLaunchPads на карті) ──
const SITES = [
  { id: 'akhtarsk',  name: 'Приморсько-Ахтарськ', region: 'Краснодарський край', re: /приморс\p{L}*[-\s]?ахтар|прим[-.\s]?ахтар|ахтарс|ахтарк/u },
  { id: 'kursk',     name: 'Курськ',              region: 'Курська обл.',        re: /курськ|курск|халін|халин/u },
  { id: 'millerovo', name: 'Міллерово',           region: 'Ростовська обл.',     re: /м[іи]ллер[еоі]в/u },
  { id: 'donetsk',   name: 'Донецьк',             region: 'окупований',          re: /донецьк|донецк/u },
  { id: 'gvard',     name: 'Гвардійське',         region: 'Крим',                re: /гвард[іие][йи]с[ь]?к/u },
  { id: 'chauda',    name: 'Чауда',               region: 'Крим',                re: /чауд/u },
  { id: 'orel',      name: 'Орел',                region: 'Орловська обл.',      re: /цимбулов|(?:^|[^\p{L}])(?:орл\p{L}*|орел|орёл)(?![\p{L}])/u },
  { id: 'shatalovo', name: 'Шаталове',            region: 'Смоленська обл.',     re: /шатал[оа]в/u },
  { id: 'nyavlya',   name: 'Нявля',               region: 'Брянська обл.',       re: /нявл|навл[яеі]/u },
  { id: 'berdyansk', name: 'Бердянськ',           region: 'окупований',          re: /бердянськ|бердянск/u },
  { id: 'yeysk',     name: 'Єйськ',               region: 'Краснодарський край', re: /[єе][йи]ськ|ейск/u },
  { id: 'saky',      name: 'Саки',                region: 'Крим',                re: /(?:^|[^\p{L}])сак(?:и|ів|ах|ам)(?![\p{L}])/u },
  { id: 'bryansk',   name: 'Брянськ',             region: 'Брянська обл.',       re: /брянськ|брянск/u },
  { id: 'mozdok',    name: 'Моздок',              region: 'Північна Осетія',     re: /моздок/u },
  { id: 'morozovsk', name: 'Морозовськ',          region: 'Ростовська обл.',     re: /морозовськ|морозовск/u },
  { id: 'engels',    name: 'Енгельс',             region: 'Саратовська обл.',    re: /енгельс|энгельс/u },
];

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[’`ʼ]/g, "'");
const plural = n => (n % 10 === 1 && n % 100 !== 11) ? 'група'
  : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? 'групи' : 'груп';
const siteIn = t => SITES.filter(s => s.re.test(t));

// Невідомий майданчик: «з Ейська», «с Моздока» — слово з великої літери після прийменника
const GENERIC_PLACE = /(?:^|[\s(])(?:з|із|с|со|из|від|от)\s+([A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,}(?:\s+[A-ZА-ЯІЇЄҐ][\p{L}'\-]{3,})?)/u;

export function parseNews(rawText) {
  const text = String(rawText || '');
  const events = [];
  // підліт: «Подлет после 22:00»
  const tm = /(?:подл[её]т|п[іи]дл[іи]т)\D{0,20}?(п[іи]сля|после|до)?\s*(\d{1,2})[:.](\d{2})/iu.exec(text);
  const note = tm ? ('підліт ' + (tm[1] ? (/до/i.test(tm[1]) ? 'до ' : 'після ') : 'близько ') + tm[2].padStart(2, '0') + ':' + tm[3]) : null;

  const clauses = text.split(/⚠️+|\n|\+|(?<=[.!?])\s+/u).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    const t = norm(clause);
    const isThreat = /можлив|загроз|угроз/u.test(t);
    const isLaunch = /(?:відбул\p{L}*|зафіксов\p{L}*|зафиксир\p{L}*)\s+пуск|(?:^|[^\p{L}])пуски/u.test(t);
    const drone = /бпла|шахед|shahed|герань|geran|дрон/u.test(t);
    if (!(isThreat || isLaunch) || !drone) continue;

    const droneAll = /реактивн|jet|герань-?3|geran-?3/u.test(t);
    const segs = clause.split(/\s*[,;]\s*|\s+(?:та|и|і)\s+/u).filter(Boolean);
    for (const seg of segs) {
      const st = norm(seg);
      let site = siteIn(st)[0] || null;
      if (!site) {
        const g = GENERIC_PLACE.exec(seg);
        if (g && !/(?:бпла|шахед)/iu.test(g[1])) site = { id: null, name: g[1].trim(), region: null };
      }
      if (!site) continue;
      const gm = /(\d{1,3})\s*груп/u.exec(st);
      events.push({
        kind: 'drone', status: 'launch', site,
        groups: gm ? Number(gm[1]) : null,
        jet: /реактивн/u.test(st) || (droneAll && segs.length === 1),
        droneType: /shahed|шахед|герань|geran/u.test(t) ? 'shahed' : 'unknown',
        note,
      });
    }
  }
  return events;
}

// ── Злиття: один майданчик = одна подія (максимум груп) ──
export function mergeEvents(list) {
  const m = new Map();
  for (const e of list) {
    const key = `drone|${e.site.id || e.site.name}`;
    const o = m.get(key);
    if (!o) { m.set(key, { ...e, key }); continue; }
    if (e.groups != null) o.groups = Math.max(o.groups || 0, e.groups);
    if (e.jet) o.jet = true;
    if (e.note && !o.note) o.note = e.note;
  }
  return [...m.values()];
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatEvents(events, footerHtml) {
  if (!events.length) return '';
  const allShahed = events.every(d => d.droneType === 'shahed');
  const lines = events.map(d => {
    const place = d.site.region ? `${d.site.name} (${d.site.region})` : d.site.name;
    const parts = [];
    if (d.groups != null) parts.push(`${d.groups} ${plural(d.groups)}`);
    if (d.jet) parts.push('реактивні');
    if (d.note) parts.push(d.note);
    return '📍 ' + esc(place) + (parts.length ? ' — ' + esc(parts.join(', ')) : '');
  });
  return '🚀 Пуски БпЛА' + (allShahed ? ' (Shahed)' : '') + '\n' + lines.join('\n') + (footerHtml ? '\n\n' + footerHtml : '');
}

// ── Що з новин варто публікувати зараз ──
// raw: [{ id, date, text }]; state.sent: { [key]: { t, g } }
const TTL_MIN = 45;
export function pickNewEvents(raw, state, now, { maxAgeMin = 20 } = {}) {
  const sent = (state && state.sent) || {};
  const stats = { total: raw.length, fresh: 0, noDate: 0, parsed: 0 };
  const events = [];
  for (const n of raw) {
    const ts = Date.parse(n.date);
    if (!isFinite(ts)) { stats.noDate++; continue; }            // без дати не ризикуємо повторами
    if (now - ts > maxAgeMin * 60000 || ts - now > 10 * 60000) continue;
    stats.fresh++;
    const ev = parseNews(n.text);
    stats.parsed += ev.length;
    events.push(...ev);
  }
  const merged = mergeEvents(events);
  const out = [], stamps = [];
  for (const e of merged) {
    const prev = sent[e.key];
    const more = (e.groups || 0) > ((prev && prev.g) || 0);
    if (prev && now - prev.t <= TTL_MIN * 60000 && !more) continue;   // уже публікували нещодавно
    out.push(e);
    stamps.push([e.key, { t: now, g: e.groups || 0 }]);
  }
  return { events: out, stamps, stats };
}
