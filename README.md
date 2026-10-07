# Cold Lead Finder (powered by Apify Store actors)

A single actor that **orchestrates Apify's own scrapers**. Give it a business type and a location, and it returns a scored cold-outreach list with **business name, location, phone, email, owner / decision-maker name, socials, website audit and pitch angles**.

## Pipeline

1. **[Google Maps Scraper](https://apify.com/compass/crawler-google-places)** (`compass/crawler-google-places`): one run per location covering all your search terms.
   * `scrapeContacts` (on by default) uses Apify's contacts add-on to pull emails and social profiles from each business website.
   * `ownerEnrichmentPerPlace` (off by default) turns on Apify's **Business leads enrichment** add-on. It adds employee names, job titles, work emails and LinkedIn profiles. This actor ranks Owner, Founder, CEO and similar titles first, and uses the top match as the owner.
2. **[Contact Details Scraper](https://apify.com/vdrmota/contact-info-scraper)** (`vdrmota/contact-info-scraper`) runs **only for businesses that still have no email**. It crawls up to N pages of their site.
3. **Website audit + owner finder** is a light built-in HTTP pass over the homepage and About/Team pages. It checks HTTPS, mobile, SEO tags, Google Ads, GA and Meta Pixel, CMS and stale footers. It also finds owner names when the leads add-on is off.
4. **Merge, dedupe, score** produces one row per business, sorted by `leadScore`.

The called runs are linked in the log and in `RUN_SUMMARY`. They are idempotent, so a migrated run reuses them instead of paying twice.

## Input example

```json
{
  "searchTerms": ["roofing contractor", "plumber"],
  "locations": ["Calgary, AB, Canada"],
  "maxPlacesPerSearch": 150,
  "websiteFilter": "allPlaces",
  "scrapeContacts": true,
  "ownerEnrichmentPerPlace": 1,
  "useContactDetailsScraper": true,
  "auditWebsites": true,
  "onlyWithEmail": true,
  "minLeadScore": 35
}
```

To pass anything else that Google Maps Scraper supports, use `mapsScraperExtraInput`, for example `{"countryCode":"ca","categoryFilterWords":["plumber"]}`.

## Output

V1 and V2 produce exactly the same columns, so your CRM import or cold-email template works with either: `businessName, category, address, city, state, postalCode, country, phone, email, emailType, allEmails, ownerName, ownerTitle, ownerEmail, ownerLinkedIn, ownerSource, ownerConfidence, otherDecisionMakers, website, googleMapsUrl, rating, reviewsCount, isClaimed, openingHours, socials…, websiteAudit{…}, leadScore, leadTier, recommendedServices, pitchAngles`.

## Cost

You pay this actor's own small compute cost (1 GB) plus the called actors at their Store prices. Google Maps Scraper charges per place, with extra per-place fees for the contacts and leads add-ons. Contact Details Scraper is billed per page. Check the current prices on each actor's Pricing tab before large runs. Leads enrichment is the most expensive part, so start with `ownerEnrichmentPerPlace: 1`.

## Deploy

```bash
npm i -g apify-cli
apify login
cd v1-apify-actors-lead-finder
apify push
```

Your Apify account needs access to both Store actors. They are public, so it only needs credit.

## Compliance

Follow **CASL**, **CAN-SPAM** or **GDPR** depending on where the recipients are: use relevant business addresses, identify yourself, and include an unsubscribe. Treat leads-enrichment personal data according to your privacy policy.
