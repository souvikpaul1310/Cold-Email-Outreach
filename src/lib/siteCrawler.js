/**
 * Visits business websites (homepage + best About/Team/Contact pages) with a
 * fast HTTP crawler and returns merged contact/owner/audit data per place.
 */
import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue } from 'crawlee';
import { extractFromHtml, prioritiseLinks, mergeSiteResults } from './websiteExtract.js';

/**
 * @param {Array<{placeKey:string, name:string, website:string}>} places
 * @param {{ proxyConfiguration?: any, maxPagesPerWebsite?: number, maxConcurrency?: number, store?: Record<string, any[]> }} opts
 * @returns {Promise<Record<string, object>>} placeKey -> merged site data
 */
export async function crawlWebsites(places, opts = {}) {
    const { proxyConfiguration, maxPagesPerWebsite = 4, maxConcurrency = 10 } = opts;
    const pagesByPlace = opts.store ?? {}; // pass a persisted object to survive migrations
    const names = Object.fromEntries(places.map((p) => [p.placeKey, p.name]));
    if (!places.length) return {};

    const runId = Actor.getEnv().actorRunId ?? 'local';
    const queue = await RequestQueue.open(`websites-${runId}`.toLowerCase());

    const crawler = new CheerioCrawler({
        requestQueue: queue,
        proxyConfiguration,
        maxConcurrency,
        maxRequestRetries: 1,
        maxSessionRotations: 1, // dead websites shouldn't be retried 10x
        requestHandlerTimeoutSecs: 45,
        navigationTimeoutSecs: 30,
        ignoreSslErrors: true,
        additionalMimeTypes: ['application/xhtml+xml', 'text/plain'],
        preNavigationHooks: [async ({ request }) => { request.userData.startedAt = Date.now(); }],
        requestHandler: async ({ request, body, response, crawler: c }) => {
            const { placeKey, isHomepage } = request.userData;
            const url = request.loadedUrl || request.url;
            const meta = { status: response?.statusCode, loadTimeMs: Date.now() - (request.userData.startedAt || Date.now()) };
            const { contactLinks, ...rest } = extractFromHtml(body.toString(), url, meta);
            (pagesByPlace[placeKey] ??= []).push({ ...rest, url, isHomepage });

            if (isHomepage && maxPagesPerWebsite > 1) {
                const next = prioritiseLinks(contactLinks, maxPagesPerWebsite - 1);
                await c.addRequests(next.map((u) => ({ url: u, uniqueKey: `${placeKey}|${u}`, userData: { placeKey, isHomepage: false } })));
            }
        },
        failedRequestHandler: async ({ request, response }, err) => {
            const { placeKey, isHomepage } = request.userData;
            if (!isHomepage) return;
            log.warning(`Website unreachable for ${names[placeKey]}: ${err.message.split('\n').pop() || err.message}`);
            (pagesByPlace[placeKey] ??= []).push({
                url: request.url, isHomepage: true, emails: [], phones: [], socials: {}, ownerCandidates: [],
                audit: {
                    finalUrl: request.url,
                    httpStatus: response?.statusCode ?? 599,
                    error: err.message.replace(/Detected a session error, rotating session\.\.\.\s*/i, '').trim().slice(0, 200),
                    usesHttps: request.url.startsWith('https'),
                },
            });
        },
    });

    await crawler.run(places.map((p) => {
        let url = /^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`;
        try { url = new URL(url).href; } catch { /* keep as-is */ }
        return { url, uniqueKey: `${p.placeKey}|${url}`, userData: { placeKey: p.placeKey, isHomepage: true } };
    }));
    await queue.drop().catch(() => {});

    const out = {};
    for (const p of places) {
        const pages = pagesByPlace[p.placeKey];
        if (pages?.length) out[p.placeKey] = mergeSiteResults(pages, p.website);
    }
    return out;
}
