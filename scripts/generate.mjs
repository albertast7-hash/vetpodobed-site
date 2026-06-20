// Генератор статической контент-витрины VetPodobed.
// Тянет опубликованные статьи из self-host Supabase (channel_posts) и пишет:
//   blog/index.html        — список статей
//   blog/<slug>.html       — страница каждой статьи (с JSON-LD Article + OG)
//   sitemap.xml            — карта сайта (главная + блог + статьи)
//
// Запуск локально:  SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/generate.mjs
// В CI берёт те же значения из переменных окружения (см. .github/workflows/build.yml).
//
// Контент авторский (rich-text из админки) — рендерим content_html как есть.
// Никакого LLM/ИИ для текста: только готовые статьи врача.

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'blog');

// --- Конфиг ---------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://supa.vetpodobed.pro').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  // anon-ключ публичен по дизайну (он же в клиенте index.html); read-only.
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc5MjgyODYzLCJleHAiOjIwOTQ2NDI4NjN9.UXtmCmsdaQoLj6V1_Llw9q9nyXMDHZ72lAOftXQdli0';
const SITE_URL = (process.env.SITE_URL || 'https://info.vetpodobed.pro').replace(/\/$/, '');
const APP_URL = 'https://app.vetpodobed.pro';
const SITE_NAME = 'VetPodobed';
const AUTHOR = 'Подобед Екатерина Владимировна';

// --- Утилиты --------------------------------------------------------------
const TRANSLIT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',
  ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
};
function slugify(title, id) {
  const base = String(title || '').toLowerCase()
    .split('').map(ch => TRANSLIT[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/,'');
  const short = String(id || '').replace(/-/g, '').slice(0, 8);
  return (base || 'post') + '-' + short;
}
// SEO-slug строим из ЗАГОЛОВКА (транслит) + id для уникальности/стабильности.
// Слуги из БД (channel_posts.slug) намеренно НЕ используем: они непоследовательны
// (часть однобуквенные «a»/«t», часть — обрывки первого предложения), что плохо
// для поисковых URL. Заголовок даёт keyword-rich адрес: /blog/amfotericin-b-127.
function postSlug(p) {
  return slugify(p.title, p.id);
}
const ESC = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }
function stripHtml(html) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
function metaDesc(post) {
  const raw = post.summary || stripHtml(post.content_html);
  return esc(raw.slice(0, 200).trim());
}
// media_url может быть КАРТИНКОЙ или ВИДЕО (в БД 65/84 — это .mp4).
function isVideo(u) { return /\.(mp4|mov|webm|m4v|ogv)$/i.test(u || ''); }
function isImage(u) { return /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(u || ''); }
// OG/Schema-картинка — только если media реально картинка (не видео).
function ogImageOf(p) { return isImage(p.media_url) ? p.media_url : null; }

// --- Данные ---------------------------------------------------------------
// Берём статьи через SECURITY DEFINER RPC get_public_posts() — она отдаёт anon-ключу
// ТОЛЬКО опубликованные статьи (is_active AND status=published). Сама таблица
// channel_posts закрыта RLS (читают только залогиненные внутри приложения).
async function fetchPosts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_posts`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  if (!res.ok) throw new Error(`RPC get_public_posts ${res.status}: ${await res.text()}`);
  return await res.json();
}

// --- Шаблоны --------------------------------------------------------------
function shell({ title, desc, canonical, ogImage, jsonld, body, ogType = 'website' }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#0f766e">
<link rel="icon" type="image/png" href="/assets/logo.png">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
<link rel="stylesheet" href="/assets/site.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
<header class="site-header">
  <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="34" height="34"><span>VetPodobed</span></a>
  <nav>
    <a href="/blog/">Статьи</a>
    <a class="cta-sm" href="${APP_URL}">Открыть приложение</a>
  </nav>
</header>
<main>${body}</main>
<footer class="site-footer">
  <div class="foot-cols">
    <div>
      <strong>VetPodobed</strong>
      <p>Ветеринарный ассистент для владельцев кошек и собак: расшифровка анализов, дневник питомца, связь с врачом.</p>
    </div>
    <div>
      <a href="${APP_URL}">Войти / Регистрация</a>
      <a href="/blog/">Все статьи</a>
      <a href="${APP_URL}/privacy.html">Политика конфиденциальности</a>
    </div>
  </div>
  <div class="foot-bottom">© ${new Date().getFullYear()} VetPodobed · Автор материалов — ${esc(AUTHOR)}</div>
</footer>
</body>
</html>`;
}

function articlePage(post, all) {
  const slug = postSlug(post);
  const canonical = `${SITE_URL}/blog/${slug}.html`;
  const desc = metaDesc(post);
  const date = post.published_at || post.created_at;
  const ogImage = ogImageOf(post);
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: post.title, description: stripHtml(post.summary || '').slice(0, 200) || undefined,
    image: ogImage || undefined, datePublished: date || undefined,
    author: { '@type': 'Person', name: AUTHOR },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${SITE_URL}/assets/logo.png` } },
    mainEntityOfPage: canonical, inLanguage: 'ru-RU'
  };
  // Навигация по серии
  let seriesNav = '';
  if (post.series_title) {
    const sibs = all.filter(p => p.series_title === post.series_title)
      .sort((a, b) => (a.series_order || 0) - (b.series_order || 0));
    const items = sibs.map(p => {
      const s = postSlug(p);
      const cur = p.id === post.id;
      return `<li>${cur ? '<b>' : ''}<a href="/blog/${s}.html">${esc(p.title)}</a>${cur ? '</b>' : ''}</li>`;
    }).join('');
    seriesNav = `<aside class="series-nav"><div class="series-title">Серия: ${esc(post.series_title)}</div><ol>${items}</ol></aside>`;
  }
  let cover = '';
  if (isVideo(post.media_url)) {
    cover = `<video class="article-cover" src="${esc(post.media_url)}" controls preload="metadata" playsinline></video>`;
  } else if (isImage(post.media_url)) {
    cover = `<img class="article-cover" src="${esc(post.media_url)}" alt="${esc(post.title)}" loading="lazy">`;
  }
  const body = `
  <article class="article">
    <nav class="crumbs"><a href="/">Главная</a> › <a href="/blog/">Статьи</a> › <span>${esc(post.title)}</span></nav>
    <h1>${esc(post.title)}</h1>
    <div class="article-meta">${post.category ? `<span class="tag">${esc(post.category)}</span>` : ''}${date ? `<time>${fmtDate(date)}</time>` : ''}</div>
    ${cover}
    <div class="article-body">${post.content_html || `<p>${esc(post.summary || '')}</p>`}</div>
    ${seriesNav}
    <div class="article-cta">
      <p>Остались вопросы по анализам или здоровью питомца?</p>
      <a class="cta" href="${APP_URL}">Задать вопрос врачу в приложении →</a>
    </div>
  </article>`;
  return shell({ title: `${post.title} — VetPodobed`, desc, canonical, ogImage, jsonld, body, ogType: 'article' });
}

function blogIndex(all) {
  const cards = all.map(p => {
    const slug = postSlug(p);
    const date = p.published_at || p.created_at;
    let img;
    if (isVideo(p.media_url)) {
      // Видео в карточке — превью по первому кадру (#t=0.1), с бейджем ▶.
      img = `<div class="card-media"><video src="${esc(p.media_url)}#t=0.1" muted preload="metadata" playsinline></video><span class="play-badge">▶</span></div>`;
    } else if (isImage(p.media_url)) {
      img = `<img src="${esc(p.media_url)}" alt="" loading="lazy">`;
    } else {
      img = '<div class="card-noimg">🐾</div>';
    }
    return `<a class="post-card" href="/blog/${slug}.html">
      ${img}
      <div class="card-body">
        ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
        <h2>${esc(p.title)}</h2>
        <p>${esc((p.summary || stripHtml(p.content_html)).slice(0, 140))}</p>
        ${date ? `<time>${fmtDate(date)}</time>` : ''}
      </div>
    </a>`;
  }).join('');
  const canonical = `${SITE_URL}/blog/`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Blog', name: 'Статьи VetPodobed', url: canonical,
    publisher: { '@type': 'Organization', name: SITE_NAME }
  };
  const body = `
  <section class="page-head">
    <h1>Статьи о здоровье кошек и собак</h1>
    <p>Начальное ветеринарное образование для владельцев: анализы, домашний осмотр, профилактика. Автор — ветеринарный врач-терапевт ${esc(AUTHOR)}.</p>
  </section>
  <section class="post-grid">${cards || '<p>Скоро здесь появятся статьи.</p>'}</section>`;
  return shell({ title: 'Статьи о здоровье питомцев — VetPodobed', desc: 'Статьи ветеринарного врача о здоровье кошек и собак: расшифровка анализов, домашний осмотр, профилактика, уход.', canonical, jsonld, body });
}

function sitemap(all) {
  const urls = [
    { loc: `${SITE_URL}/`, pri: '1.0' },
    { loc: `${SITE_URL}/blog/`, pri: '0.8' },
    ...all.map(p => ({ loc: `${SITE_URL}/blog/${postSlug(p)}.html`, pri: '0.7', lastmod: (p.published_at || p.created_at || '').slice(0, 10) }))
  ];
  const body = urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

// --- Сборка ---------------------------------------------------------------
async function main() {
  console.log(`→ Тяну статьи из ${SUPABASE_URL} …`);
  const posts = await fetchPosts();
  console.log(`✓ Получено опубликованных статей: ${posts.length}`);

  if (!existsSync(BLOG_DIR)) mkdirSync(BLOG_DIR, { recursive: true });
  // Чистим старые сгенерированные .html (кроме .gitkeep)
  for (const f of readdirSync(BLOG_DIR)) if (f.endsWith('.html')) unlinkSync(join(BLOG_DIR, f));

  let n = 0;
  for (const post of posts) {
    const slug = postSlug(post);
    writeFileSync(join(BLOG_DIR, `${slug}.html`), articlePage(post, posts));
    n++;
  }
  writeFileSync(join(BLOG_DIR, 'index.html'), blogIndex(posts));
  writeFileSync(join(ROOT, 'sitemap.xml'), sitemap(posts));
  console.log(`✓ Сгенерировано: ${n} статей + blog/index.html + sitemap.xml`);
}

main().catch(e => { console.error('✗ Ошибка генерации:', e); process.exit(1); });
