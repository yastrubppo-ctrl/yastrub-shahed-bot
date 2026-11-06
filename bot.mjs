// Запуск: node bot.mjs
// Джерело даних — ЛИШЕ DIMAP News API (https://api.dimap.live/news). Жодних інших джерел.
//
// Змінні середовища:
//   TG_BOT_TOKEN, TG_CHAT_ID     — токен бота та ID каналу (обов'язково, крім DRY_RUN)
//   DRY_RUN=1                    — нічого не надсилати і не зберігати, лише друкувати в лог
//   MAX_AGE_MIN=20               — брати новини не старші за стільки хвилин
//   FOOTER_TEXT, FOOTER_LINK     — необов'язковий підпис («Яструб Моніторить 🦅» + посилання)
//   DIMAP_NEWS_URL              — адреса DIMAP News: за замовчуванням https://api.dimap.live/news.
//                                 Якщо Cloudflare блокує GitHub (HTTP 403 «Just a moment…») — вкажи свій проксі
//                                 https://ТВІЙ-САЙТ.vercel.app/api/dimap/news (той самий DIMAP, але через твій сервер)
//   VERCEL_BYPASS               — ключ «Protection Bypass for Automation» (потрібен, якщо сайт на Vercel закритий захистом)
//   TG_API_BASE                 — лише для тестів
import fs from 'node:fs';
import crypto from 'node:crypto';
import { BOT_NAME, pickNewEvents, formatEvents } from './parser.mjs';

const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
const NEWS_URL = process.env.DIMAP_NEWS_URL || 'https://api.dimap.live/news';
const VERCEL_BYPASS = process.env.VERCEL_BYPASS || '';
const TG_API = process.env.TG_API_BASE || 'https://api.telegram.org';
const MAX_AGE_MIN = Number(process.env.MAX_AGE_MIN || 20);
const DRY_RUN = process.env.DRY_RUN === '1';
const STATE_FILE = new URL('./state.json', import.meta.url);

if (!DRY_RUN && (!TG_BOT_TOKEN || !TG_CHAT_ID)) { console.error('❌ Потрібні секрети TG_BOT_TOKEN і TG_CHAT_ID (або DRY_RUN=1).'); process.exit(1); }

// ── очищення HTML із Telegram: <br> → рядки, теги геть, сутності розкодовано ──
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function cleanHtml(h) {
  return String(h == null ? '' : h)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      try {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      } catch { return m; }
      return NAMED[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// ── перетворення відповіді API на [{ id, date, text }] (форма відповіді може відрізнятись) ──
function firstStr(n, keys) { for (const k of keys) if (typeof n[k] === 'string' && n[k]) return n[k]; return ''; }
export function normalizeFeed(j) {
  const list = Array.isArray(j) ? j
    : [j && j.news, j && j.items, j && j.messages, j && j.data, j && j.results, j && j.data && j.data.news, j && j.data && j.data.items].find(Array.isArray) || [];
  return list.map(n => {
    if (typeof n === 'string') n = { text: n };
    if (!n || typeof n !== 'object') return null;
    const text = cleanHtml(firstStr(n, ['text', 'title', 'message', 'content', 'body', 'html', 'caption', 'description']));
    if (!text) return null;
    let d = [n.date, n.timestamp, n.time, n.createdAt, n.created_at, n.publishedAt, n.ts].find(v => v != null);
    if (typeof d === 'string' && /^\d{9,13}$/.test(d)) d = Number(d);
    if (typeof d === 'number') d = new Date(d < 1e12 ? d * 1000 : d).toISOString();
    const id = String([n.id, n._id, n.messageId, n.message_id, n.url].find(v => v != null) ?? crypto.createHash('sha1').update(text + d).digest('hex').slice(0, 12));
    return { id, date: d, text };
  }).filter(Boolean);
}

async function fetchNews() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const headers = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; yastrub-bot)' };
      // ключ Vercel відправляємо ЛИШЕ на адресу, яку задав ти (ніколи не на api.dimap.live)
      if (VERCEL_BYPASS && new URL(NEWS_URL).hostname !== 'api.dimap.live') headers['x-vercel-protection-bypass'] = VERCEL_BYPASS;
      const r = await fetch(NEWS_URL, { headers, signal: ctrl.signal });
      console.log(`DIMAP News: HTTP ${r.status} (спроба ${attempt})`);
      const body = await r.text();
      if (!r.ok) {
        if (/just a moment|cf-chl|cloudflare/i.test(body)) console.log('ℹ️ Це захист Cloudflare від автоматичних запитів: він не пускає сервери GitHub. Вкажи у секреті DIMAP_NEWS_URL адресу через свій Vercel (…/api/dimap/news).');
        else if (/vercel authentication|_vercel_sso|authentication required/i.test(body)) console.log('ℹ️ Сайт на Vercel закритий захистом. Додай секрет VERCEL_BYPASS (Protection Bypass for Automation).');
        throw new Error('HTTP ' + r.status + ' ' + body.slice(0, 120).replace(/\s+/g, ' '));
      }
      let j; try { j = JSON.parse(body); } catch { throw new Error('відповідь не JSON: ' + body.slice(0, 120)); }
      const root = Array.isArray(j) ? '[масив]' : Object.keys(j || {}).join(', ');
      const feed = normalizeFeed(j);
      const first = Array.isArray(j) ? j[0] : null;
      console.log(`Формат: ключі кореня = ${root}` + (first && typeof first === 'object' ? ` | ключі першої новини = ${Object.keys(first).join(', ')}` : ''));
      if (!feed.length) throw new Error('у відповіді немає новин');
      return feed;
    } catch (e) { lastErr = e; console.log('⚠️ ' + (e && e.message)); await new Promise(r => setTimeout(r, 1500 * attempt)); }
    finally { clearTimeout(to); }
  }
  throw lastErr;
}

// ── пам'ять між запусками ──
let state = { sent: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
state.sent = state.sent || {};

async function sendTelegram(html) {
  const r = await fetch(`${TG_API}/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return r.json();
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const footerHtml = process.env.FOOTER_TEXT
  ? (process.env.FOOTER_LINK ? `<a href="${esc(process.env.FOOTER_LINK)}">${esc(process.env.FOOTER_TEXT)}</a>` : esc(process.env.FOOTER_TEXT))
  : '';

console.log(`▶ Бот «${BOT_NAME}»${DRY_RUN ? ' [DRY_RUN]' : ''}`);
let feed;
try { feed = await fetchNews(); } catch (e) { console.error('❌ Не вдалося отримати новини DIMAP:', e && e.message); process.exit(1); }

const now = Date.now();
const pick = pickNewEvents(feed, state, now, { maxAgeMin: MAX_AGE_MIN });
console.log(`Новин: ${pick.stats.total}; свіжих (≤${MAX_AGE_MIN} хв): ${pick.stats.fresh}; без дати: ${pick.stats.noDate}; подій розпізнано: ${pick.stats.parsed}; до публікації: ${pick.events.length}`);
const newest = feed.map(n => Date.parse(n.date)).filter(isFinite).sort((a, b) => b - a)[0];
if (newest) console.log(`Остання новина в стрічці: ${new Date(newest).toISOString()} (${Math.round((now - newest) / 60000)} хв тому)`);

if (!pick.events.length) { console.log('Нічого нового — виходжу.'); process.exit(0); }

const text = formatEvents(pick.events, footerHtml);
if (DRY_RUN) { console.log('────── ПОВІДОМЛЕННЯ (DRY_RUN, не надсилається) ──────\n' + text + '\n──────────────────────────────'); process.exit(0); }

const res = await sendTelegram(text);
console.log('Telegram:', JSON.stringify(res).slice(0, 200));
if (!res.ok) { console.error('❌ Telegram відхилив повідомлення (перевір токен, ID каналу і що бот — адмін каналу).'); process.exit(1); }

pick.stamps.forEach(([k, v]) => { state.sent[k] = v; });
for (const k of Object.keys(state.sent)) if (now - state.sent[k].t > 24 * 3600000) delete state.sent[k];
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
console.log('✅ Надіслано, пам\'ять оновлено.');
