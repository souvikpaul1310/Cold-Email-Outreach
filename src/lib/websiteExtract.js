/**
 * Website enrichment: emails, phones, socials, owner/decision-maker names,
 * and a lightweight marketing audit (SEO / PPC / web-dev signals).
 * Pure functions over HTML (Cheerio) so it can be reused by any crawler.
 */
import * as cheerio from 'cheerio';

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi;

const JUNK_EMAIL_PARTS = [
    'example.', 'domain.com', 'yourdomain', 'yoursite', 'email.com', 'sentry', 'wixpress.com',
    'sentry.io', '@2x', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js',
    'godaddy.com', 'squarespace.com', 'wordpress.com', 'schema.org', 'test@', 'name@',
    'user@', 'john@doe', 'johndoe', 'janedoe', 'noreply', 'no-reply', 'donotreply',
    'privacy@cloudflare', 'filler@', 'u003e', 'mysite.com', 'company.com',
];

const GENERIC_PREFIXES = [
    'info', 'contact', 'hello', 'hi', 'admin', 'office', 'support', 'sales', 'enquiries',
    'enquiry', 'inquiries', 'inquiry', 'mail', 'team', 'booking', 'bookings', 'reception',
    'service', 'services', 'help', 'marketing', 'billing', 'accounts', 'careers', 'jobs', 'hr',
    'appointments', 'frontdesk', 'general', 'orders', 'customerservice', 'webmaster',
];

export const OWNER_TITLES = [
    'owner', 'co-owner', 'founder', 'co-founder', 'cofounder', 'ceo', 'chief executive officer',
    'president', 'managing director', 'managing partner', 'proprietor', 'principal',
    'director', 'general manager', 'partner', 'lead dentist', 'principal dentist',
    'medical director', 'head chef', 'chef/owner', 'broker', 'broker of record', 'managing broker',
];

const TITLE_ALT = OWNER_TITLES
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[-/]/g, (m) => `\\${m}`))
    .join('|');

// Names never span line breaks ([ \\t] instead of \\s)
const NAME = "(?:Dr\\.?[ \\t]+|Mr\\.?[ \\t]+|Mrs\\.?[ \\t]+|Ms\\.?[ \\t]+)?[A-Z][a-zA-Z'’-]{1,20}(?:[ \\t]+[A-Z]\\.?)?(?:[ \\t]+[A-Z][a-zA-Z'’-]{1,25}){1,2}";
// "Jane Smith, Founder" | "Jane Smith - Owner" | "Jane Smith (CEO)"
const NAME_THEN_TITLE = new RegExp(`(${NAME})\\s*(?:,|–|—|-|\\||\\(|:)\\s*(?:the\\s+|our\\s+)?(?:co-?)?(${TITLE_ALT})\\b`, 'g');
// "Founder: Jane Smith" | "Owner Jane Smith" | "CEO & Founder, Jane Smith"
const TITLE_THEN_NAME = new RegExp(`\\b(${TITLE_ALT})(?:[ \\t]*(?:&|and)[ \\t]*(?:${TITLE_ALT}))?[ \\t]*(?:,|:|–|—|-|\\|)?[ \\t]*(${NAME})`, 'gi');
// "founded by Jane Smith" | "owned and operated by Jane Smith"
const FOUNDED_BY = new RegExp(`\\b(founded|owned(?:\\s+and\\s+operated)?|run|led|established|started)\\s+by\\s+(${NAME})`, 'gi');

const NAME_STOPWORDS = new Set([
    'our', 'the', 'team', 'about', 'contact', 'us', 'home', 'services', 'service', 'meet', 'welcome',
    'company', 'business', 'call', 'today', 'free', 'read', 'more', 'learn', 'view', 'click', 'here',
    'privacy', 'policy', 'terms', 'book', 'now', 'get', 'quote', 'news', 'blog', 'menu', 'all', 'rights',
    'reserved', 'copyright', 'inc', 'ltd', 'llc', 'corp', 'group', 'dental', 'clinic', 'law', 'office',
    'street', 'avenue', 'road', 'suite', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'google', 'facebook', 'instagram', 'linkedin',
    'and', 'of', 'for', 'with', 'by', 'in', 'at', 'board', 'executive', 'chief', 'officer', 'operating',
    'managing', 'general', 'manager', 'director', 'founder', 'owner', 'president', 'partner', 'ceo',
    'principal', 'leadership', 'staff', 'story', 'mission', 'vision', 'values', 'testimonials',
]);

const CONTACT_PAGE_RE = /(contact|about|team|our-?story|who-?we-?are|staff|leadership|people|meet|founder|owner|management|impressum|imprint|company|reach-?us|get-?in-?touch)/i;

export function decodeCfEmail(hex) {
    try {
        const key = parseInt(hex.slice(0, 2), 16);
        let out = '';
        for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
        return out;
    } catch { return null; }
}

function deobfuscate(text) {
    return text
        .replace(/\s*(?:\[|\(|\{)\s*at\s*(?:\]|\)|\})\s*/gi, '@')
        .replace(/\s+at\s+(?=[a-z0-9-]+\s*(?:\[|\(|\{)?\s*dot)/gi, '@')
        .replace(/\s*(?:\[|\(|\{)\s*dot\s*(?:\]|\)|\})\s*/gi, '.')
        .replace(/&#64;|&#x40;/gi, '@')
        .replace(/&#46;|&#x2e;/gi, '.');
}

export function cleanEmail(raw) {
    if (!raw) return null;
    let e = String(raw).trim().toLowerCase()
        .replace(/^mailto:/, '')
        .split('?')[0]
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    try { e = decodeURIComponent(e); } catch { /* ignore */ }
    if (!/^[a-z0-9][a-z0-9._%+-]*@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/.test(e)) return null;
    if (JUNK_EMAIL_PARTS.some((j) => e.includes(j))) return null;
    if (/^[0-9a-f]{16,}@/.test(e)) return null; // hashed tracking ids
    return e;
}

export function emailType(email) {
    const local = email.split('@')[0].replace(/[._-]?\d+$/, '');
    return GENERIC_PREFIXES.includes(local) ? 'generic' : 'personal';
}

/** Rank emails: personal on the business's own domain > generic on own domain > anything else. */
export function rankEmails(emails, websiteUrl) {
    const domain = rootDomain(websiteUrl);
    const score = (e) => {
        let s = 0;
        const d = e.split('@')[1];
        if (domain && (d === domain || d.endsWith(`.${domain}`))) s += 10;
        if (emailType(e) === 'personal') s += 5;
        if (/gmail|yahoo|hotmail|outlook|icloud|aol|live\.|rogers|shaw|telus|sympatico/.test(d)) s += 2;
        return s;
    };
    return [...new Set(emails)].sort((a, b) => score(b) - score(a));
}

export function rootDomain(url) {
    if (!url) return null;
    try {
        const h = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
        return h.toLowerCase();
    } catch { return null; }
}

function cleanName(n) {
    if (!n) return null;
    const name = n.replace(/\s+/g, ' ').replace(/[,.;:|]+$/, '').trim();
    const words = name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').split(' ');
    if (words.length < 2 || words.length > 4) return null;
    if (words.some((w) => NAME_STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))) return null;
    if (words.some((w) => w.length > 1 && w === w.toUpperCase() && w.length > 3)) return null; // SHOUTING headings
    return name;
}

function normTitle(t) {
    const x = t.toLowerCase().trim();
    if (x === 'cofounder') return 'Co-Founder';
    return x.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bCeo\b/, 'CEO');
}

function titleWeight(title) {
    const t = (title || '').toLowerCase();
    if (/owner|proprietor|founder/.test(t)) return 3;
    if (/ceo|president|managing|principal|broker/.test(t)) return 2;
    return 1;
}

/** Extract owner/decision-maker candidates from JSON-LD + visible text. */
export function extractOwners($, text, pageUrl) {
    const found = [];
    const dedupe = new Set();
    const add = (name, title, source, confidence) => {
        const n = cleanName(name);
        if (!n) return;
        const k = `${n}|${title}|${source}`.toLowerCase();
        if (dedupe.has(k)) return;
        dedupe.add(k);
        found.push({ name: n, title: title ? normTitle(title) : null, source, confidence, url: pageUrl });
    };

    // 1) Structured data (most reliable)
    $('script[type="application/ld+json"]').each((_, el) => {
        let data;
        try { data = JSON.parse($(el).contents().text()); } catch { return; }
        const stack = Array.isArray(data) ? [...data] : [data];
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (Array.isArray(node)) { stack.push(...node); continue; }
            for (const key of ['founder', 'founders', 'owner', 'employee', 'employees', 'member', 'members', 'author']) {
                const v = node[key];
                const list = Array.isArray(v) ? v : v ? [v] : [];
                for (const p of list) {
                    if (typeof p === 'string') add(p, key === 'author' ? null : key.replace(/s$/, ''), 'json-ld', key === 'author' ? 0.3 : 0.9);
                    else if (p?.name) add(p.name, p.jobTitle || key.replace(/s$/, ''), 'json-ld', key === 'author' ? 0.3 : 0.9);
                }
            }
            if (node['@type'] === 'Person' && node.name && node.jobTitle
                && new RegExp(TITLE_ALT, 'i').test(String(node.jobTitle))) {
                add(node.name, node.jobTitle, 'json-ld', 0.9);
            }
            if (node['@graph']) stack.push(node['@graph']);
            for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
        }
    });

    // 2) Visible text patterns
    const t = text.replace(/[ \t\u00a0]+/g, ' ');
    for (const m of t.matchAll(NAME_THEN_TITLE)) add(m[1], m[2], 'text', 0.7);
    for (const m of t.matchAll(TITLE_THEN_NAME)) add(m[2], m[1], 'text', 0.6);
    for (const m of t.matchAll(FOUNDED_BY)) add(m[2], /owned/i.test(m[1]) ? 'Owner' : 'Founder', 'text', 0.7);

    // 3) Team cards: heading with a name followed by a small title element
    $('h2, h3, h4, h5, strong').each((_, el) => {
        const name = $(el).text().trim();
        if (name.length > 40) return;
        const next = $(el).next().text().trim().slice(0, 60);
        const m = next.match(new RegExp(`^(?:the\\s+)?(${TITLE_ALT})\\b`, 'i'));
        if (m) add(name, m[1], 'team-card', 0.75);
    });

    return found;
}

export function pickBestOwner(candidates) {
    if (!candidates?.length) return null;
    const byName = new Map();
    for (const c of candidates) {
        const key = c.name.toLowerCase();
        const prev = byName.get(key);
        const score = c.confidence + titleWeight(c.title) * 0.1;
        if (!prev) byName.set(key, { ...c, score, mentions: 1 });
        else {
            prev.mentions += 1;
            prev.score = Math.max(prev.score, score) + 0.05;
            if (titleWeight(c.title) > titleWeight(prev.title)) prev.title = c.title;
        }
    }
    const best = [...byName.values()].sort((a, b) => b.score - a.score)[0];
    return { ...best, confidence: Math.min(0.99, Number(best.score.toFixed(2))) };
}

const SOCIAL_PATTERNS = {
    facebook: /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|plugins|dialog|tr\b|login)[^\s"'<>?#]+/i,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|accounts)[a-z0-9_.]+/i,
    linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/[^\s"'<>?#]+/i,
    twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search)[a-z0-9_]{1,15}\b/i,
    youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|user\/|@)[^\s"'<>?#]+/i,
    tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[a-z0-9_.]+/i,
};

/** Marketing-gap signals used for SEO / PPC / web-dev pitch angles. */
export function auditPage($, html, url, meta = {}) {
    const lower = html.toLowerCase();
    const title = $('title').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content')?.trim() || '';
    const yearMatch = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2}|19\d{2})/gi)].map((m) => +m[1]);
    const copyrightYear = yearMatch.length ? Math.max(...yearMatch) : null;
    let cms = null;
    if (/wp-content|wp-includes/.test(lower)) cms = 'WordPress';
    else if (/static\.wixstatic|wix\.com/.test(lower)) cms = 'Wix';
    else if (/cdn\.shopify|shopify\.com/.test(lower)) cms = 'Shopify';
    else if (/squarespace/.test(lower)) cms = 'Squarespace';
    else if (/webflow/.test(lower)) cms = 'Webflow';
    else if (/godaddy|secureserver|websites\.godaddy|img1\.wsimg/.test(lower)) cms = 'GoDaddy Builder';
    else if (/weebly/.test(lower)) cms = 'Weebly';
    else if (/joomla/.test(lower)) cms = 'Joomla';
    else if (/duda|dudamobile|multiscreensite/.test(lower)) cms = 'Duda';

    return {
        finalUrl: url,
        httpStatus: meta.status ?? null,
        loadTimeMs: meta.loadTimeMs ?? null,
        usesHttps: url?.startsWith('https://') ?? false,
        mobileFriendly: $('meta[name="viewport"]').length > 0,
        title: title || null,
        titleLength: title.length,
        hasMetaDescription: metaDesc.length > 0,
        h1Count: $('h1').length,
        hasSchemaMarkup: $('script[type="application/ld+json"]').length > 0,
        hasGoogleAnalytics: /gtag\(|googletagmanager\.com\/gtag\/js\?id=g-|google-analytics\.com|ga\('create'/.test(lower),
        hasGoogleTagManager: /googletagmanager\.com\/gtm\.js|gtm-[a-z0-9]{4,}/.test(lower),
        hasGoogleAdsTag: /aw-\d{6,}|googleadservices\.com|google_conversion_id/.test(lower),
        hasMetaPixel: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(/.test(lower),
        hasLiveChat: /intercom|drift\.com|tawk\.to|livechatinc|zendesk|crisp\.chat|tidio|hubspot/.test(lower),
        hasOnlineBooking: /calendly|acuityscheduling|booksy|vagaro|squareup\.com\/appointments|setmore|jane\.app|zocdoc|opentable|resy/.test(lower),
        cms,
        copyrightYear,
        wordCount: $('body').text().split(/\s+/).filter(Boolean).length,
    };
}

/**
 * Main entry: parse one HTML page and return everything we can find.
 */
export function extractFromHtml(html, pageUrl, meta = {}) {
    const $ = cheerio.load(html);
    $('script:not([type="application/ld+json"]), style, noscript, svg').remove();
    // Keep block boundaries as line breaks so adjacent elements don't glue together
    $('br').replaceWith('\n');
    $('p, div, li, h1, h2, h3, h4, h5, h6, td, th, section, article, header, footer, dt, dd, figcaption, address')
        .each((_, el) => { $(el).prepend('\n').append('\n'); });
    const text = ($('body').text() || '').replace(/\n\s*\n+/g, '\n');

    const emails = new Set();
    $('a[href^="mailto:"]').each((_, a) => { const e = cleanEmail($(a).attr('href')); if (e) emails.add(e); });
    $('[data-cfemail]').each((_, el) => { const e = cleanEmail(decodeCfEmail($(el).attr('data-cfemail'))); if (e) emails.add(e); });
    $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, a) => {
        const e = cleanEmail(decodeCfEmail(($(a).attr('href') || '').split('#')[1] || '')); if (e) emails.add(e);
    });
    for (const m of deobfuscate(`${text} ${html}`).matchAll(EMAIL_RE)) { const e = cleanEmail(m[0]); if (e) emails.add(e); }

    const phones = new Set();
    $('a[href^="tel:"]').each((_, a) => {
        const p = ($(a).attr('href') || '').replace(/^tel:/, '').replace(/[^\d+]/g, '');
        if (p.replace(/\D/g, '').length >= 7) phones.add(p);
    });

    const socials = {};
    const hrefs = $('a[href]').map((_, a) => $(a).attr('href')).get();
    for (const [k, re] of Object.entries(SOCIAL_PATTERNS)) {
        const hit = hrefs.find((h) => re.test(h));
        if (hit) socials[k] = hit.match(re)[0].replace(/\/$/, '');
    }

    const base = rootDomain(pageUrl);
    const contactLinks = [];
    $('a[href]').each((_, a) => {
        const href = $(a).attr('href');
        const label = $(a).text().trim();
        if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
        let abs;
        try { abs = new URL(href, pageUrl).href.split('#')[0]; } catch { return; }
        if (rootDomain(abs) !== base) return;
        if (/\.(pdf|jpg|jpeg|png|gif|zip|docx?|xlsx?|mp4)$/i.test(abs)) return;
        if (CONTACT_PAGE_RE.test(abs) || CONTACT_PAGE_RE.test(label)) contactLinks.push(abs);
    });

    // Re-load full HTML for JSON-LD owner extraction (we removed non-JSON scripts only).
    const ownerCandidates = extractOwners($, text, pageUrl);

    return {
        emails: [...emails],
        phones: [...phones],
        socials,
        contactLinks: [...new Set(contactLinks)],
        ownerCandidates,
        audit: auditPage(cheerio.load(html), html, pageUrl, meta),
    };
}

/** Prioritise which internal pages to visit for owner/email discovery. */
export function prioritiseLinks(links, max) {
    const rank = (u) => {
        const p = u.toLowerCase();
        if (/about|our-?story|who-?we-?are/.test(p)) return 0;
        if (/team|staff|leadership|people|meet|founder|owner|management/.test(p)) return 1;
        if (/contact|reach|get-?in-?touch/.test(p)) return 2;
        if (/impressum|imprint/.test(p)) return 3;
        return 4;
    };
    return [...new Set(links)].sort((a, b) => rank(a) - rank(b) || a.length - b.length).slice(0, max);
}

/** Merge several page extractions for the same business website. */
export function mergeSiteResults(pages, websiteUrl) {
    const emails = new Set();
    const phones = new Set();
    const socials = {};
    const owners = [];
    let audit = null;
    for (const p of pages) {
        p.emails.forEach((e) => emails.add(e));
        p.phones.forEach((x) => phones.add(x));
        for (const [k, v] of Object.entries(p.socials)) socials[k] ??= v;
        owners.push(...p.ownerCandidates);
        if (!audit && p.isHomepage) audit = p.audit;
    }
    if (!audit && pages[0]) audit = pages[0].audit;
    // tracking tags can live on any page
    if (audit) {
        for (const k of ['hasGoogleAnalytics', 'hasGoogleTagManager', 'hasGoogleAdsTag', 'hasMetaPixel', 'hasLiveChat', 'hasOnlineBooking']) {
            audit[k] = pages.some((p) => p.audit?.[k]);
        }
    }
    // Owner inferred from a personal email if nothing else (low confidence)
    const ranked = rankEmails([...emails], websiteUrl);
    let owner = pickBestOwner(owners);
    if (owner && !owner.email) {
        const first = owner.name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').split(' ')[0].toLowerCase();
        owner.email = ranked.find((e) => e.split('@')[0].includes(first)) || null;
    }
    return { emails: ranked, phones: [...phones], socials, owner, ownerCandidates: owners, audit, pagesVisited: pages.map((p) => p.url) };
}
