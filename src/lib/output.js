/**
 * Builds the final flat, CSV-friendly lead record (same shape in V1 and V2).
 */
import { emailType } from './websiteExtract.js';
import { scoreLead } from './scoring.js';

export function buildLead(place, site, ctx = {}) {
    const owner = place.owner || site?.owner || null;
    const emails = [...new Set([owner?.email, ...(site?.emails || []), ...(place.emails || [])].filter(Boolean))];
    const primaryEmail = (owner?.email && emails.includes(owner.email) ? owner.email : null) || emails[0] || null;

    const lead = {
        businessName: place.name || null,
        category: place.category || null,
        address: place.address || null,
        city: place.city || null,
        state: place.state || null,
        postalCode: place.postalCode || null,
        country: place.countryCode || null,
        phone: place.phone || site?.phones?.[0] || null,
        email: primaryEmail,
        emailType: primaryEmail ? emailType(primaryEmail) : null,
        allEmails: emails.join(', ') || null,
        ownerName: owner?.name || null,
        ownerTitle: owner?.title || null,
        ownerEmail: owner?.email || null,
        ownerLinkedIn: owner?.linkedin || null,
        ownerSource: owner?.source || null,
        ownerConfidence: owner?.confidence ?? null,
        otherDecisionMakers: [...(place.otherContacts || []), ...(site?.ownerCandidates || [])]
            .filter((c) => c.name && c.name !== owner?.name)
            .map((c) => [c.name, c.title, c.email].filter(Boolean).join(' – '))
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .slice(0, 5)
            .join(' | ') || null,
        website: place.website || null,
        googleMapsUrl: place.url || null,
        rating: place.rating ?? null,
        reviewsCount: place.reviewsCount ?? null,
        isClaimed: place.isClaimed ?? null,
        priceLevel: place.priceLevel || null,
        openingHours: place.openingHours || null,
        facebook: site?.socials?.facebook || place.facebook || null,
        instagram: site?.socials?.instagram || place.instagram || null,
        linkedin: site?.socials?.linkedin || place.linkedin || null,
        twitter: site?.socials?.twitter || place.twitter || null,
        youtube: site?.socials?.youtube || place.youtube || null,
        tiktok: site?.socials?.tiktok || place.tiktok || null,
        websiteAudit: site?.audit || null,
        latitude: place.lat ?? null,
        longitude: place.lng ?? null,
        placeId: place.placeId || null,
        searchTerm: ctx.searchTerm || place.searchTerm || null,
        searchLocation: ctx.location || place.searchLocation || null,
        scrapedAt: new Date().toISOString(),
    };
    return { ...lead, ...scoreLead(lead) };
}

export function passesFilters(lead, input) {
    if (input.onlyWithEmail && !lead.email) return false;
    if (input.onlyWithoutWebsite && lead.website) return false;
    if (input.minLeadScore && lead.leadScore < input.minLeadScore) return false;
    if (input.maxRating && lead.rating != null && lead.rating > input.maxRating) return false;
    if (input.excludeKeywords?.length) {
        const hay = `${lead.businessName} ${lead.category}`.toLowerCase();
        if (input.excludeKeywords.some((k) => k && hay.includes(k.toLowerCase()))) return false;
    }
    return true;
}
