// Minimal mock of the Apify API endpoints V1 uses (start run, wait, list dataset items)
import http from 'node:http';
const maps = [
  { title: 'Bright Smile Dental', categoryName: 'Dentist', address: '123 Main St, Mississauga, ON L5B 1A1', city: 'Mississauga', state: 'Ontario', postalCode: 'L5B 1A1', countryCode: 'CA',
    phone: '(905) 555-0101', website: 'http://localhost:8765/', url: 'https://www.google.com/maps/place/x', totalScore: 3.8, reviewsCount: 14, claimThisBusiness: true,
    placeId: 'ChIJ1', location: { lat: 43.59, lng: -79.64 }, searchString: 'dentist', emails: [], openingHours: [{ day: 'Monday', hours: '9 AM to 5 PM' }] },
  { title: 'Joe Mobile Dentistry', categoryName: 'Dentist', address: '9 King St, Mississauga, ON L5B 2B2', city: 'Mississauga', phone: '(905) 555-0199', website: null,
    totalScore: 4.9, reviewsCount: 6, claimThisBusiness: false, placeId: 'ChIJ2', searchString: 'dentist',
    leadsEnrichment: [{ fullName: 'Ana Lee', jobTitle: 'Office Manager', email: 'ana@joedent.ca' }, { fullName: 'Joe Rivera', jobTitle: 'Owner', email: 'joe@joedent.ca', linkedinProfile: 'https://linkedin.com/in/joerivera' }] },
  { title: 'Closed Clinic', permanentlyClosed: true, placeId: 'ChIJ3' },
  { title: 'Bright Smile Dental', placeId: 'ChIJ1' },
];
const contacts = [{ originalStartUrl: 'http://localhost:8765/', domain: 'localhost', emails: ['frontdesk@brightsmile.ca'], phones: [], facebooks: ['https://facebook.com/bs'] }];
const runs = {}; let n = 0;
http.createServer((req, res) => {
  const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x'); console.log(req.method, u.pathname);
  let m;
  if (req.method === 'POST' && (m = u.pathname.match(/^\/v2\/act(?:or)?s\/([^/]+)\/runs$/))) {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      const id = `run${++n}`; const ds = m[1].includes('google') ? 'maps' : 'contacts';
      runs[id] = { id, status: 'SUCCEEDED', defaultDatasetId: ds, actId: m[1], input: JSON.parse(body) };
      console.log('  input:', body.slice(0, 300)); send({ data: runs[id] });
    }); return;
  }
  if ((m = u.pathname.match(/^\/v2\/actor-runs\/([^/]+)$/))) return send({ data: runs[m[1]] });
  if ((m = u.pathname.match(/^\/v2\/datasets\/([^/]+)\/items$/))) {
    const all = m[1] === 'maps' ? maps : contacts; const off = +u.searchParams.get('offset') || 0;
    const items = all.slice(off, off + (+u.searchParams.get('limit') || 1000));
    res.setHeader('x-apify-pagination-total', all.length); res.setHeader('x-apify-pagination-offset', off);
    res.setHeader('x-apify-pagination-count', items.length); res.setHeader('x-apify-pagination-limit', 1000);
    return send(items);
  }
  res.statusCode = 404; send({ error: { message: 'not mocked ' + u.pathname } });
}).listen(8777, () => console.log('mock api on 8777'));
