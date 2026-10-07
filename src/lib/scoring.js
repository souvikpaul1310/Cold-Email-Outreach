/**
 * Lead scoring for an SEO / PPC / Web-Development agency.
 * Higher score = bigger marketing gap + reachable = better cold-outreach prospect.
 */
const CURRENT_YEAR = new Date().getFullYear();

export function scoreLead(lead) {
    let score = 0;
    const services = new Set();
    const angles = [];
    const a = lead.websiteAudit;

    // ---- Website / Web development gaps ----
    if (!lead.website) {
        score += 30;
        services.add('Web Development');
        services.add('Local SEO');
        angles.push('No website listed on Google Maps — customers who search for you cannot find a site to convert on.');
    } else if (a) {
        if (a.error || (a.httpStatus && a.httpStatus >= 400)) {
            score += 25;
            services.add('Web Development');
            services.add('SEO');
            angles.push(
                a.httpStatus && a.httpStatus < 599
                    ? `Website returns an error (HTTP ${a.httpStatus}) — visitors from Google are hitting a broken page.`
                    : 'The website listed on Google Maps is down / unreachable — every click from Maps is a lost customer.',
            );
        } else {
            if (!a.usesHttps) {
                score += 8;
                services.add('Web Development');
                angles.push('Site is not on HTTPS — browsers show "Not secure", which hurts trust and rankings.');
            }
            if (!a.mobileFriendly) {
                score += 10;
                services.add('Web Development');
                angles.push('Site has no mobile viewport — likely hard to use on phones, where most local searches happen.');
            }
            if (a.copyrightYear && a.copyrightYear <= CURRENT_YEAR - 3) {
                score += 6;
                services.add('Web Development');
                angles.push(`Footer says © ${a.copyrightYear} — the site looks unmaintained.`);
            }
            if (a.loadTimeMs && a.loadTimeMs > 4000) {
                score += 5;
                services.add('Web Development');
                angles.push(`Homepage took ${(a.loadTimeMs / 1000).toFixed(1)}s to load.`);
            }
            if (['Wix', 'GoDaddy Builder', 'Weebly'].includes(a.cms)) {
                score += 4;
                services.add('Web Development');
            }

            // ---- SEO gaps ----
            if (!a.title || a.titleLength < 15) {
                score += 6;
                services.add('SEO');
                angles.push('Homepage title tag is missing or too short for search.');
            }
            if (!a.hasMetaDescription) {
                score += 5;
                services.add('SEO');
                angles.push('No meta description — Google writes its own snippet for you.');
            }
            if (a.h1Count === 0) {
                score += 3;
                services.add('SEO');
            }
            if (!a.hasSchemaMarkup) {
                score += 3;
                services.add('Local SEO');
            }
            if (a.wordCount && a.wordCount < 250) {
                score += 4;
                services.add('SEO');
                angles.push('Very thin homepage content (under 250 words).');
            }

            // ---- PPC / tracking gaps ----
            if (!a.hasGoogleAdsTag && !a.hasMetaPixel) {
                score += 8;
                services.add('PPC');
                angles.push('No Google Ads or Meta Pixel tracking found — not capturing paid traffic or retargeting.');
            }
            if (!a.hasGoogleAnalytics && !a.hasGoogleTagManager) {
                score += 5;
                services.add('Analytics & Tracking');
                angles.push('No Google Analytics / Tag Manager detected — no visibility into where leads come from.');
            }
        } // end reachable-site checks
    }

    // ---- Google Business Profile / reputation gaps ----
    if (lead.isClaimed === false) {
        score += 12;
        services.add('Local SEO');
        angles.push('Google Business Profile appears unclaimed — the owner cannot reply to reviews or update info.');
    }
    if (lead.rating != null && lead.rating < 4.0) {
        score += 8;
        services.add('Reputation Management');
        angles.push(`Google rating is ${lead.rating}★ — below the 4.0 threshold many customers filter on.`);
    }
    if (lead.reviewsCount != null && lead.reviewsCount < 25) {
        score += 8;
        services.add('Local SEO');
        angles.push(`Only ${lead.reviewsCount} Google reviews — competitors with more reviews outrank you in the map pack.`);
    }
    if (!lead.facebook && !lead.instagram && !lead.linkedin) {
        score += 3;
        services.add('Social Media');
    }

    // ---- Reachability (can we actually cold-email them?) ----
    let reach = 0;
    if (lead.email) reach += 1;
    if (lead.email && lead.emailType === 'personal') reach += 1;
    if (lead.ownerName) reach += 1;
    if (lead.phone) reach += 0.5;
    score += Math.round(reach * 4);

    if (!lead.email) score = Math.round(score * 0.75); // still useful for calls, but less for email outreach
    score = Math.max(0, Math.min(100, score));

    let tier = 'Cold';
    if (score >= 55) tier = 'Hot';
    else if (score >= 35) tier = 'Warm';

    return {
        leadScore: score,
        leadTier: tier,
        recommendedServices: [...services].join(', '),
        pitchAngles: angles.slice(0, 5).join(' | '),
    };
}
