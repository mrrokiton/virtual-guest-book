/* global open, __ENV, __VU */
// Peak load from the MVP plan: 200 guests joining one wedding within 5 minutes, while 20 weddings
// run in parallel. Guests browse the gallery and a share of them upload photos.
//
//   k6 run -e BASE_URL=https://staging.example.com \
//          -e WEDDINGS="slug1:PIN1,slug2:PIN2,...,slug20:PIN20" load/k6-wedding.js
//
// The first wedding in the list gets the 200-guest burst; the rest share the parallel load.
// Use staging weddings on the premium plan (5000 files): the run uploads real photos.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WEDDINGS = (__ENV.WEDDINGS || '')
  .split(',')
  .filter(Boolean)
  .map((pair) => {
    const [slug, pin] = pair.split(':');
    return { slug, pin };
  });
const PHOTO = open('../apps/web/e2e/fixtures/photo.jpg', 'b');

if (WEDDINGS.length === 0) throw new Error('Set WEDDINGS="slug:PIN,..."');

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      exec: 'burstGuest',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 200 },
        { duration: '3m', target: 200 },
        { duration: '30s', target: 0 },
      ],
    },
    parallel: {
      executor: 'constant-vus',
      exec: 'parallelGuest',
      vus: 19 * 15,
      duration: '8m30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:session}': ['p(95)<500'],
    'http_req_duration{name:gallery}': ['p(95)<500'],
    'http_req_duration{name:file}': ['p(95)<500'],
    'http_req_duration{name:upload-start}': ['p(95)<500'],
    'http_req_duration{name:upload-complete}': ['p(95)<500'],
    // "No lost uploads": every started upload must be confirmed.
    'checks{step:upload}': ['rate>0.999'],
  },
};

let joined = false;

function join(w) {
  if (joined) return true;
  const res = http.post(
    `${BASE_URL}/api/w/${w.slug}/session`,
    JSON.stringify({ pin: w.pin, displayName: `k6-${__VU}`, acceptTerms: true }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'session' } },
  );
  joined = check(res, { joined: (r) => r.status === 200 });
  return joined;
}

function browse(w) {
  const page = http.get(`${BASE_URL}/api/w/${w.slug}/media?limit=30`, {
    tags: { name: 'gallery' },
  });
  check(page, { 'gallery 200': (r) => r.status === 200 });
  const items = page.status === 200 ? page.json('items') : [];
  for (const item of items.slice(0, 6)) {
    if (!item.thumbUrl) continue;
    const res = http.get(`${BASE_URL}${item.thumbUrl}`, { redirects: 0, tags: { name: 'file' } });
    check(res, { 'file redirect': (r) => r.status === 302 });
  }
}

function upload(w) {
  const tags = { step: 'upload' };
  const start = http.post(
    `${BASE_URL}/api/w/${w.slug}/uploads`,
    JSON.stringify({ contentType: 'image/jpeg', size: PHOTO.byteLength }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'upload-start' } },
  );
  if (!check(start, { 'upload slot': (r) => r.status === 200 }, tags)) return;
  const { mediaId, upload: target } = start.json();
  const put = http.put(target.url, PHOTO, {
    headers: target.headers,
    tags: { name: 'storage-put' },
  });
  if (!check(put, { stored: (r) => r.status === 200 }, tags)) return;
  const done = http.post(`${BASE_URL}/api/w/${w.slug}/uploads/${mediaId}/complete`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'upload-complete' },
  });
  check(done, { completed: (r) => r.status === 200 }, tags);
}

function guest(w) {
  if (!join(w)) return sleep(5);
  browse(w);
  // Roughly one in four guests uploads something on each visit.
  if (Math.random() < 0.25) upload(w);
  sleep(5 + Math.random() * 10);
}

export function burstGuest() {
  guest(WEDDINGS[0]);
}

export function parallelGuest() {
  guest(WEDDINGS[1 + (__VU % Math.max(1, WEDDINGS.length - 1))] || WEDDINGS[0]);
}
