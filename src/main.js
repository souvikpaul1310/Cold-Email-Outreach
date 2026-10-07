/**
 * Cold Lead Finder — powered by Apify Store actors.
 *
 * Step 1  compass/crawler-google-places      (Apify's Google Maps Scraper)
 *           → businesses + website emails/socials (scrapeContacts)
 *           → optional owner / decision-maker enrichment (leads add-on, paid per record)
 * Step 2  vdrmota/contact-info-scraper       (Apify's Contact Details Scraper)
 *           → deeper email/phone/social crawl for sites where step 1 found no email
 * Step 3  Light website audit + owner finder (built-in code, cheap HTTP requests)
 * Step 4  Merge, dedupe, score for SEO / PPC / Web-dev outreach → dataset
 */
import { Actor, log } from 'apify';
import { buildLead, passesFilters } from './lib/output.js';
import { crawlWebsites } from './lib/siteCrawler.js';
import { rootDomain, cleanEmail, OWNER_TITLES } from './lib/websiteExtract.js';

const MAPS_ACTOR = 'compass/crawler-google-places';
const CONTACTS_ACTOR = 'vdrmota/contact-info-scraper';

await Actor.init();
const raw = (await Actor.getInput()) ?? {};
const input = {
    searchTerms: raw.searchTerms?.filter(Boolean) ?? [],
    locations: raw.locations?.filter(Boolean) ?? [],
    maxPlacesPerSearch: raw.maxPlacesPerSearch ?? 50,
    language: raw.language || 'en',
    skipClosedPlaces: raw.skipClosedPlaces ?? true,
    websiteFilter: raw.websiteFilter || 'allPlaces',
    placeMinimumStars: raw.placeMinimumStars && raw.placeMinimumStars !== 'any' ? raw.placeMinimumStars : '',
    scrapeContacts: raw.scrapeContacts ?? true,
    ownerEnrichmentPerPlace: raw.ownerEnrichmentPerPlace ?? 0,
    leadsEnrichmentDepartments: raw.leadsEnrichmentDepartments ?? [],
    useContactDetailsScraper: raw.useContactDetailsScraper ?? true,
    contactScraperMaxPagesPerSite: raw.contactScraperMaxPagesPerSite ?? 5,
    auditWebsites: raw.auditWebsites ?? true,
    maxPagesPerWebsite: raw.maxPagesPerWebsite ?? 3,
    onlyWithEmail: raw.onlyWithEmail ?? false,
    onlyWithoutWebsite: raw.onlyWithoutWebsite ?? false,
    minLeadScore: raw.minLeadScore ?? 0,
    maxRating: raw.maxRating ?? null,
    excludeKeywords: raw.excludeKeywords ?? [],
    mapsScraperExtraInput: raw.mapsScraperExtraInput ?? {},
    childActorMemoryMbytes: raw.childActorMemoryMbytes ?? 4096,
};
if (!input.searchTerms.length || !input.locations.length) {
    throw new Error('Please provide at least one search term (e.g. "dentist") and one location (e.g. "Toronto, ON").');
}

const proxyConfiguration = await Actor.createProxyConfiguration(raw.proxyConfiguration ?? { useApifyProxy: true });
const state = await Actor.useState('V1_STATE', { mapsRuns: {}, contactsRunId: null, sitePages: {}, pushed: 0, filtered: 0 });

/** Run a store actor once (idempotent across migrations) and return all its dataset items. */
async function callActorOnce(key, actorId, actorInput, registry) {
    let runId = registry[key];
    if (!runId) {
        log.info(`▶ Starting ${actorId} (${key})`);
        const run = await Actor.start(actorId, actorInput, { memory: input.childActorMemoryMbytes });
        runId = run.id;
        registry[key] = runId;
        log.info(`  Run: https://console.apify.com/actors/runs/${runId}`);
    }
    const client = Actor.apifyClient;
    const finished = await client.run(runId).waitForFinish();
    if (finished.status !== 'SUCCEEDED') {
        log.warning(`${actorId} run ${runId} ended with status ${finished.status} — using whatever it saved.`);
    }
    const items = [];
    const ds = client.dataset(finished.defaultDatasetId);
    for (let offset = 0; ; offset += 1000) {
        const { items: page } = await ds.listItems({ offset, limit: 1000, clean: true });
        items.push(...page);
        if (page.length < 1000) break;
    }
    return items;
}

// ---------------- Step 1: Google Maps Scraper ----------------
const ownerRe = new RegExp(OWNER_TITLES.join('|'), 'i');
const pickOwner = (people = []) => {
    const norm = people.map((p) => ({
        name: p.fullName || p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
        title: p.jobTitle || p.title || p.position || null,
        email: cleanEmail(p.email || p.workEmail || null),
        linkedin: p.linkedinProfile || p.linkedInProfile || p.linkedinUrl || p.linkedin || null,
        phone: p.mobileNumber || p.phone || null,
    })).filter((p) => p.name);
    const rank = (p) => (/owner|founder|proprietor/i.test(p.title) ? 3 : ownerRe.test(p.title || '') ? 2 : 1) + (p.email ? 0.5 : 0);
    norm.sort((a, b) => rank(b) - rank(a));
    return { owner: norm[0] ? { ...norm[0], source: 'apify-leads-enrichment', confidence: 0.95 } : null, others: norm.slice(1) };
};

const places = new Map();
for (const location of input.locations) {
    await Actor.setStatusMessage(`Google Maps Scraper: "${input.searchTerms.join(', ')}" in ${location}…`);
    const mapsInput = {
        searchStringsArray: input.searchTerms,
        locationQuery: location,
        maxCrawledPlacesPerSearch: input.maxPlacesPerSearch,
        language: input.language,
        skipClosedPlaces: input.skipClosedPlaces,
        website: input.websiteFilter,
        scrapeContacts: input.scrapeContacts,
        scrapePlaceDetailPage: true, // needed for "claim this business" flag, opening hours etc.
        maxReviews: 0,
        maxImages: 0,
        maximumLeadsEnrichmentRecords: input.ownerEnrichmentPerPlace,
        ...(input.leadsEnrichmentDepartments.length ? { leadsEnrichmentDepartments: input.leadsEnrichmentDepartments } : {}),
        ...(input.placeMinimumStars ? { placeMinimumStars: input.placeMinimumStars } : {}),
        ...input.mapsScraperExtraInput,
    };
    const items = await callActorOnce(`maps:${location}`, MAPS_ACTOR, mapsInput, state.mapsRuns);
    log.info(`Google Maps Scraper returned ${items.length} places for ${location}.`);

    for (const it of items) {
        if (!it.title) continue;
        const placeKey = it.placeId || it.cid || it.url || `${it.title}|${it.address}`;
        if (places.has(placeKey)) continue;
        if (input.skipClosedPlaces && (it.permanentlyClosed || it.temporarilyClosed)) continue;
        const { owner, others } = pickOwner(it.leadsEnrichment || it.leads || []);
        places.set(placeKey, {
            placeKey,
            name: it.title,
            category: it.categoryName || it.categories?.[0] || null,
            address: it.address || null,
            city: it.city || null,
            state: it.state || null,
            postalCode: it.postalCode || null,
            countryCode: it.countryCode || null,
            phone: it.phone || it.phoneUnformatted || null,
            website: it.website || null,
            url: it.url || null,
            rating: it.totalScore ?? null,
            reviewsCount: it.reviewsCount ?? null,
            isClaimed: it.claimThisBusiness == null ? null : !it.claimThisBusiness,
            priceLevel: it.price || null,
            openingHours: Array.isArray(it.openingHours) ? it.openingHours.map((h) => `${h.day}: ${h.hours}`).join('; ') : null,
            lat: it.location?.lat ?? null,
            lng: it.location?.lng ?? null,
            placeId: it.placeId || null,
            emails: (it.emails || []).map(cleanEmail).filter(Boolean),
            facebook: it.facebooks?.[0] || null,
            instagram: it.instagrams?.[0] || null,
            linkedin: it.linkedIns?.[0] || null,
            twitter: it.twitters?.[0] || null,
            youtube: it.youtubes?.[0] || null,
            tiktok: it.tiktoks?.[0] || null,
            owner,
            otherContacts: others,
            searchTerm: it.searchString || null,
            searchLocation: location,
        });
    }
}
log.info(`Unique businesses after dedupe: ${places.size}`);

// ---------------- Step 2: Contact Details Scraper (only where no email yet) ----------------
const needContacts = [...places.values()].filter((p) => p.website && !p.emails.length);
if (input.useContactDetailsScraper && needContacts.length) {
    await Actor.setStatusMessage(`Contact Details Scraper: crawling ${needContacts.length} websites with no email yet…`);
    const reg = { contacts: state.contactsRunId };
    const items = await callActorOnce('contacts', CONTACTS_ACTOR, {
        startUrls: needContacts.map((p) => ({ url: p.website })),
        maxRequestsPerStartUrl: input.contactScraperMaxPagesPerSite,
        maxDepth: 2,
        sameDomain: true,
        mergeContacts: true,
        considerChildFrames: true,
        proxyConfig: { useApifyProxy: true },
    }, reg);
    state.contactsRunId = reg.contacts;

    const byDomain = new Map();
    for (const it of items) {
        const d = rootDomain(it.originalStartUrl || it.url || it.domain);
        if (!d) continue;
        const acc = byDomain.get(d) || { emails: [], phones: [] };
        acc.emails.push(...(it.emails || []));
        acc.phones.push(...(it.phones || []));
        for (const [k, f] of [['facebook', 'facebooks'], ['instagram', 'instagrams'], ['linkedin', 'linkedIns'], ['twitter', 'twitters'], ['youtube', 'youtubes'], ['tiktok', 'tiktoks']]) {
            acc[k] ??= it[f]?.[0];
        }
        byDomain.set(d, acc);
    }
    for (const p of needContacts) {
        const hit = byDomain.get(rootDomain(p.website));
        if (!hit) continue;
        p.emails.push(...hit.emails.map(cleanEmail).filter(Boolean));
        p.phone ??= hit.phones[0] || null;
        for (const k of ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'tiktok']) p[k] ??= hit[k] || null;
    }
}

// ---------------- Step 3: website audit + owner finder ----------------
let sites = {};
const withSite = [...places.values()].filter((p) => p.website);
if (input.auditWebsites && withSite.length) {
    await Actor.setStatusMessage(`Auditing ${withSite.length} websites for SEO / PPC / web gaps and owner names…`);
    sites = await crawlWebsites(withSite, {
        proxyConfiguration,
        maxPagesPerWebsite: input.maxPagesPerWebsite,
        maxConcurrency: 10,
        store: state.sitePages,
    });
}

// ---------------- Step 4: merge, score, push ----------------
const leads = [];
for (const p of places.values()) {
    const lead = buildLead(p, sites[p.placeKey] || null);
    if (!passesFilters(lead, input)) { state.filtered += 1; continue; }
    leads.push(lead);
}
leads.sort((a, b) => b.leadScore - a.leadScore);
await Actor.pushData(leads);
state.pushed = leads.length;

await Actor.setValue('RUN_SUMMARY', {
    businessesFound: places.size,
    leadsSaved: leads.length,
    filteredOut: state.filtered,
    withEmail: leads.filter((l) => l.email).length,
    withOwnerName: leads.filter((l) => l.ownerName).length,
    hot: leads.filter((l) => l.leadTier === 'Hot').length,
    warm: leads.filter((l) => l.leadTier === 'Warm').length,
    childRuns: { maps: state.mapsRuns, contacts: state.contactsRunId },
});
await Actor.setStatusMessage(`Done: ${leads.length} leads saved (${leads.filter((l) => l.email).length} with email, ${leads.filter((l) => l.ownerName).length} with owner name).`, { isStatusMessageTerminal: true });
await Actor.exit();
