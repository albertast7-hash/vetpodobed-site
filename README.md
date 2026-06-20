# VetPodobed — контент-витрина (публичный сайт)

Статическая открытая витрина приложения [VetPodobed](https://app.vetpodobed.pro):
лендинг + блог со статьями ветеринарного врача. Нужна для **SEO** — чтобы сайт и статьи
находились в Яндексе и Google и приводили новых пользователей в приложение.

Само приложение (за авторизацией) живёт отдельно на `app.vetpodobed.pro` — этот репозиторий
его НЕ содержит. Здесь только публичные индексируемые страницы.

> Полная стратегия продвижения — в основном репозитории: `docs/seo-promotion-plan.md`.

## Что внутри

```
index.html              Лендинг (главная) — статичный, весь контент в HTML
assets/site.css         Стили
assets/logo.png         Логотип
assets/og-cover.png     Картинка для соцсетей (Open Graph)
robots.txt              + ссылка на sitemap
scripts/generate.mjs    Генератор: тянет channel_posts из Supabase → blog/*.html + sitemap.xml
blog/                   Сгенерированные страницы статей (создаются генератором)
sitemap.xml             Карта сайта (создаётся генератором)
.github/workflows/      GHA: генерация + деплой на GitHub Pages
```

## Как это работает

1. Генератор `scripts/generate.mjs` ходит в self-host Supabase
   (`https://supa.vetpodobed.pro/rest/v1/channel_posts`, только опубликованные статьи,
   read-only через публичный anon-ключ) и создаёт по статичной HTML-странице на каждую статью
   с разметкой `Article` (JSON-LD), Open Graph и кнопкой-конверсией в приложение.
2. GitHub Actions запускает генератор **по пушу, по расписанию (каждые 6 ч) и вручную**,
   затем публикует всё на GitHub Pages.
3. Новые статьи, опубликованные в админке, появляются на сайте автоматически в течение 6 часов
   (или сразу — ручным запуском workflow «Build & deploy vitrine»).

## Локальный запуск генератора

```bash
node scripts/generate.mjs          # использует дефолты (supa.vetpodobed.pro, vetpodobed.pro)
# или с переопределением:
SITE_URL=https://info.vetpodobed.pro SUPABASE_URL=https://supa.vetpodobed.pro node scripts/generate.mjs
python -m http.server 8080         # открыть http://localhost:8080 для проверки
```

## Первичная настройка GitHub Pages (один раз)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. (Опц.) **Settings → Secrets and variables → Actions → Variables:** `SITE_URL`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` — если значения отличаются от дефолтных в коде.
3. **Кастомный домен.** apex `vetpodobed.pro` сейчас занят калькулятором (репозиторий `vetCalc`).
   Варианты:
   - выделить витрине **поддомен** (напр. `blog.vetpodobed.pro` или `info.vetpodobed.pro`):
     добавить файл `CNAME` с этим именем + CNAME-запись в DNS на `albertast7-hash.github.io`;
   - или перенести калькулятор на поддомен и отдать apex витрине.
   До решения по домену сайт доступен по адресу `https://albertast7-hash.github.io/<repo>/`.
4. После публикации — **подтвердить домен в Яндекс.Вебмастер и Google Search Console**
   и загрузить туда `sitemap.xml`.

## Важно

- **Никакого ИИ для текста статей** — публикуется только авторский контент врача из `channel_posts`.
- Контент берётся из боевой БД read-only; на сайте — копия опубликованного.
- При изменении структуры `channel_posts` — поправить список колонок в `scripts/generate.mjs`.
