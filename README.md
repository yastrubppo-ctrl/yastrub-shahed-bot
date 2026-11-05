# Бот пусків БпЛА (шахедів)

Бере новини **виключно з DIMAP News API** (`https://api.dimap.live/news`) і публікує в Telegram-канал:
пуски БпЛА: майданчик пуску, кількість груп, реактивні, підліт.

Файли: `bot.mjs` (запуск), `parser.mjs` (розбір саме цього типу загроз), `.github/workflows/run.yml`.
Секрети (GitHub → Settings → Secrets and variables → Actions): `TG_BOT_TOKEN`, `TG_CHAT_ID`.
Необов'язково (вкладка Variables): `FOOTER_TEXT`, `FOOTER_LINK` — підпис під повідомленням.

Тест без відправки: Actions → Run workflow → `dry_run = true`.
Тест відправки на старіших новинах: `max_age_min = 600`.
Розклад: cron-job.org → POST на `.../actions/workflows/run.yml/dispatches` з тілом `{"ref":"main"}`.
