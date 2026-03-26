/**
 * GrowingUpTogether.ai — Backend Server
 *
 * This server handles:
 * 1. Serves the landing page and static files
 * 2. Proxies Family GPT requests to Claude (API key stays private)
 * 3. Persistent database for all signups (surveys, leaders, book buyers)
 * 4. Admin dashboard API with filtering, search, and export
 * 5. Stripe Checkout for $0.99 book payments
 *
 * SETUP:
 *   1. Install Node.js (https://nodejs.org)
 *   2. Open a terminal in this folder
 *   3. Run: npm install
 *   4. Copy .env.example to .env and fill in your keys:
 *        ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
 *        STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx  (or sk_test_ for testing)
 *        STRIPE_PRICE_ID=price_xxxxxxxxxxxxx
 *   5. Run: node server.js
 *   6. Open http://localhost:3000
 *
 * DATABASE:
 *   All signups are stored in data/signups.json
 *   This file is created automatically and persists across restarts.
 *   Back it up periodically.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ── Load .env ──
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && !key.startsWith('#')) process.env[key] = val;
    }
  });
}

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_BOOK = process.env.STRIPE_PRICE_BOOK || '';
const STRIPE_PRICE_BUNDLE = process.env.STRIPE_PRICE_BUNDLE || '';
const STRIPE_SHIPPING_US = process.env.STRIPE_SHIPPING_US || '';
const STRIPE_SHIPPING_INTL = process.env.STRIPE_SHIPPING_INTL || '';
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-sonnet-4-5-20250929';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'growingup2026';

// Email config
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '587';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Rod Wilson <Rod@growinguptogether.ai>';
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* nodemailer not installed — emails disabled */ }

// ══════════════════════════════════════════
// EMAIL — Automated thank-you emails
// ══════════════════════════════════════════
let emailTransporter = null;

function initEmailTransporter() {
  if (!nodemailer || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('  Email: Not configured (add SMTP settings to .env)');
    return;
  }
  emailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT),
    secure: parseInt(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  emailTransporter.verify((err) => {
    if (err) console.error('  Email: Connection failed —', err.message);
    else console.log('  Email: Connected ✓');
  });
}

function getEmailTemplate(type, data) {
  const name = (data.name || '').split(' ')[0] || 'Friend';
  const headerColor = '#1a1a2e';
  const accentColor = '#c0392b';
  const goldColor = '#d4a84b';
  const creamBg = '#faf8f5';

  const wrapper = (subject, headline, body) => ({
    subject,
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${creamBg};font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${creamBg};padding:2rem 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:${headerColor};padding:2rem;text-align:center;">
  <h1 style="margin:0;color:${goldColor};font-family:Georgia,serif;font-size:1.6rem;font-weight:700;letter-spacing:0.02em;">Growing Up Together</h1>
  <p style="margin:0.5rem 0 0;color:#a0a0b0;font-size:0.85rem;letter-spacing:0.05em;">THE CONVERSATION STARTS HERE</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:2.5rem 2rem;">
  <h2 style="margin:0 0 1.2rem;color:${headerColor};font-family:Georgia,serif;font-size:1.4rem;">${headline}</h2>
  <div style="color:#333;font-size:1rem;line-height:1.8;">
    ${body}
  </div>
</td></tr>

<!-- CTA -->
<tr><td style="padding:0 2rem 2rem;text-align:center;">
  <a href="https://growinguptogether.ai" style="display:inline-block;background:${accentColor};color:#ffffff;padding:0.8rem 2rem;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.95rem;">Visit GrowingUpTogether.ai</a>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f0ebe4;padding:1.5rem 2rem;text-align:center;">
  <p style="margin:0 0 0.5rem;color:#666;font-size:0.85rem;">Be the one who starts the conversation.</p>
  <p style="margin:0;color:#999;font-size:0.75rem;">© ${new Date().getFullYear()} Rod Wilson, Ph.D. — GrowingUpTogether.ai</p>
</td></tr>

</table>
</td></tr></table></body></html>`
  });

  switch (type) {
    case 'survey':
      return wrapper(
        'Thank you for sharing your voice — Growing Up Together',
        `${name}, your voice matters.`,
        `<p>Thank you for taking the survey. Every response helps us understand what families are going through — and shapes how we can help.</p>
        <p>You just did something most people only think about: you stood up and said <em>"this matters to me."</em></p>
        <p>The conversation about kids, screens, and social media needs people like you — not just policymakers and tech companies, but parents, grandparents, and community members who are willing to lead.</p>
        <p style="margin-top:1.5rem;padding:1rem;background:#faf8f5;border-left:3px solid ${goldColor};border-radius:4px;"><strong>Want to do more?</strong> Consider becoming a Community Leader and help organize conversations in your neighborhood, school, or place of worship. Every movement starts with one person who says, <em>"I'll go first."</em></p>`
      );

    case 'leader':
      return wrapper(
        'Welcome, Community Leader — Growing Up Together',
        `${name}, you just stepped up.`,
        `<p>By signing up to lead, you've done something powerful — you've said, <em>"I'm not going to wait for someone else to fix this."</em></p>
        <p>Community Leaders are the backbone of this movement. Whether you organize a book discussion at your kitchen table, a parent meetup at school, or a conversation at your place of worship — you're creating a space where families can reconnect.</p>
        <p><strong>Here's what happens next:</strong></p>
        <p>We'll send you a Leader Toolkit with everything you need to get started — discussion guides, conversation starters from the <em>Make the Moments Matter</em> card deck, and practical tips for bringing families together.</p>
        <p style="margin-top:1.5rem;padding:1rem;background:#faf8f5;border-left:3px solid ${goldColor};border-radius:4px;"><strong>Remember:</strong> You don't need to have all the answers. You just need to be willing to start the conversation. That's what leaders do.</p>`
      );

    case 'book':
      const pkg = data.package === 'bundle' ? 'the Complete Family Package (eBook + Make the Moments Matter card deck + digital app)' : 'the eBook';
      return wrapper(
        'Your copy is reserved — Growing Up Together',
        `${name}, you're in.`,
        `<p>Thank you for reserving ${pkg}. You've just invested in something that will pay dividends for generations — real conversations with the people who matter most.</p>
        <p><em>Growing Up Together</em> isn't just a book to read. It's a book to <strong>live</strong>. Every chapter is designed to help your family reconnect in a world that's pulling everyone apart.</p>
        ${data.package === 'bundle' ? '<p>Your <strong>Make the Moments Matter</strong> card deck will transform ordinary moments — dinner, the drive to school, waiting for practice — into conversations your children will remember forever. And one day, they\'ll do the same with their children.</p>' : ''}
        <p style="margin-top:1.5rem;padding:1rem;background:#faf8f5;border-left:3px solid ${goldColor};border-radius:4px;"><strong>While you wait for launch:</strong> Start one conversation today. Ask someone at your table, <em>"What's one thing you wish we talked about more?"</em> You might be surprised by the answer.</p>`
      );

    case 'cards':
      return wrapper(
        'You\'re on the list — Make the Moments Matter',
        `${name}, the moments start now.`,
        `<p>Thank you for your interest in <strong>Make the Moments Matter</strong> — the conversation card deck that helps families rediscover the art of talking to each other.</p>
        <p>We'll notify you the moment it's available. But here's the thing — you don't need to wait for the cards to start.</p>
        <p>Tonight at dinner, try this: put every phone in a basket by the door. Then ask everyone at the table, <em>"What's one thing that happened today that surprised you?"</em></p>
        <p>That's it. No fancy tools. No apps. Just a question and the willingness to listen.</p>
        <p style="margin-top:1.5rem;padding:1rem;background:#faf8f5;border-left:3px solid ${goldColor};border-radius:4px;"><strong>This is how it starts.</strong> One question. One moment. One family at a time. And by the time you've gone through every card, you won't need them anymore — because the conversation will be part of who you are.</p>`
      );

    default:
      return wrapper(
        'Thank you — Growing Up Together',
        `Thank you, ${name}.`,
        `<p>Thank you for being part of the Growing Up Together community. Every family that joins this conversation makes it stronger.</p>
        <p>The world needs people who are willing to put down their screens and look each other in the eye. People who believe that the dinner table still matters. People like you.</p>
        <p style="margin-top:1.5rem;padding:1rem;background:#faf8f5;border-left:3px solid ${goldColor};border-radius:4px;"><strong>Be a leader.</strong> Share this with another family. Start a conversation. Be the one who goes first.</p>`
      );
  }
}

function sendThankYouEmail(type, data) {
  if (!emailTransporter || !data.email) return;

  const template = getEmailTemplate(type, data);
  const mailOptions = {
    from: EMAIL_FROM,
    to: data.email,
    subject: template.subject,
    html: template.html,
  };

  emailTransporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error(`[EMAIL] Failed to send ${type} thank-you to ${data.email}:`, err.message);
    } else {
      console.log(`[EMAIL] Sent ${type} thank-you to ${data.email}`);
    }
  });
}

// ══════════════════════════════════════════
// DATABASE — Simple JSON file storage
// ══════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'signups.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load or initialize database
let db = { signups: [], stats: { total: 0, surveys: 0, leaders: 0, books: 0, payments: 0 } };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { console.error('Warning: Could not parse database file, starting fresh.'); }
}

function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Error saving database:', e.message); }
}

function addSignup(type, data) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type: type,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US'),
    ...data,
  };
  db.signups.push(entry);
  db.stats.total = db.signups.length;
  db.stats.surveys = db.signups.filter(s => s.type === 'survey').length;
  db.stats.leaders = db.signups.filter(s => s.type === 'leader').length;
  db.stats.books = db.signups.filter(s => s.type === 'book').length;
  db.stats.payments = db.signups.filter(s => s.type === 'book' && s.paid).length;
  saveDB();
  console.log(`[${type.toUpperCase()}] New signup: ${entry.email || entry.name || 'anonymous'}`);

  // Send automated thank-you email
  sendThankYouEmail(type, entry);

  return entry;
}

// ══════════════════════════════════════════
// CLAUDE AI — Family GPT
// ══════════════════════════════════════════
const SYSTEM_PROMPT = `You are the Family GPT, a private, family-defined AI reference from the book "Growing Up Together: How Families Can Stay Connected in a World of Screens, Social Media, and AI" by Rod Wilson, Ph.D.

CORE PHILOSOPHY (from the book):
- You are memory, not authority. You preserve shared understanding over time so it does not disappear when things get hard.
- You do NOT replace parents, children, judgment, or responsibility.
- You do NOT decide what is right. You do NOT take sides.
- You exist to support conversations — not to replace them.
- Everything you offer is based only on what the family has chosen to share.
- The Family GPT is not the solution. The family is.

THE MITCHELL FAMILY (this is a demo family):
- David (Father, 42): Management executive who makes hundreds of decisions every day. Struggles to switch from "boss mode" to "dad mode" after work. Cares deeply but is drained by evening.
- Sarah (Mother, 40): The glue. Constantly worried about the kids. Tries to track social media but the kids run circles around her with technology. Usually the one who implements advice — so keep it practical for a busy, stretched-thin parent.
- Maya (Daughter, 13): Athletic, popular, opinionated. Slightly spoiled. Challenges authority regularly. Pushes boundaries. Confident and social. Respect her strong personality — do not lecture her, engage her.
- Ethan (Son, 10): Quiet, reserved, isolationist. Does not easily communicate face-to-face. Prefers smartphone and social media over in-person conversation. Gently encourage connection without making him feel pressured or broken.

YOUR APPROACH:
- Give DIRECT, ACTIONABLE advice. Start every response with a concrete step the family can take tonight or this week.
- Be warm, practical, and non-judgmental.
- Focus on conversation and connection over restriction — never just suggest taking devices away.
- Reference the "Make the Moments Matter" card deck conversation starters when relevant.
- Keep responses focused (2-4 paragraphs). Do not ramble.
- When emotions rise, perspective narrows and memory shortens — help the family hold onto what they have already agreed matters.
- Offer specific conversation starters and next steps.
- Be conversational and warm, not clinical.
- Never repeat family bio information back to the user. They already know their family. Get straight to the advice.
- Each response should feel unique and tailored to the specific question asked.`;

function callClaudeAPI(messages, callback) {
  if (!API_KEY) {
    callback(new Error('No API key configured. Add ANTHROPIC_API_KEY to your .env file.'));
    return;
  }

  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: messages,
  });

  const options = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(requestBody),
    },
  };

  const req = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) callback(new Error(parsed.error.message || 'API error'));
        else if (parsed.content && parsed.content[0]) callback(null, parsed.content[0].text);
        else callback(new Error('Unexpected API response'));
      } catch (e) { callback(new Error('Failed to parse API response')); }
    });
  });

  req.on('error', (e) => callback(e));
  req.write(requestBody);
  req.end();
}

// ══════════════════════════════════════════
// STRIPE — Book payment
// ══════════════════════════════════════════
function createStripeCheckout(email, name, packageType, callback) {
  const priceId = packageType === 'bundle' ? STRIPE_PRICE_BUNDLE : STRIPE_PRICE_BOOK;
  if (!STRIPE_SECRET || !priceId) {
    callback(new Error('Stripe not configured. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ keys to .env'));
    return;
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'mode': 'payment',
    'success_url': `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `${baseUrl}/#signup`,
    'customer_email': email,
    'metadata[name]': name,
    'metadata[package]': packageType,
    'metadata[source]': 'growinguptogether.ai',
  });

  // Bundle includes physical card deck — collect shipping address and apply shipping rate
  if (packageType === 'bundle') {
    params.append('shipping_address_collection[allowed_countries][0]', 'US');
    params.append('shipping_address_collection[allowed_countries][1]', 'CA');
    params.append('shipping_address_collection[allowed_countries][2]', 'GB');
    params.append('shipping_address_collection[allowed_countries][3]', 'AU');
    // Add shipping rate options if configured
    if (STRIPE_SHIPPING_US) {
      params.append('shipping_options[0][shipping_rate]', STRIPE_SHIPPING_US);
    }
    if (STRIPE_SHIPPING_INTL) {
      params.append('shipping_options[1][shipping_rate]', STRIPE_SHIPPING_INTL);
    }
  }

  const postData = params.toString();

  const options = {
    hostname: 'api.stripe.com',
    port: 443,
    path: '/v1/checkout/sessions',
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(STRIPE_SECRET + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const req = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) callback(new Error(parsed.error.message));
        else callback(null, parsed);
      } catch (e) { callback(new Error('Stripe response error')); }
    });
  });

  req.on('error', (e) => callback(e));
  req.write(postData);
  req.end();
}

// ══════════════════════════════════════════
// STATIC FILE SERVING
// ══════════════════════════════════════════
const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serveStatic(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.stat(filePath, (err, stats) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': stats.size, 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Helper to read POST body
function readBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => callback(body));
}

// ══════════════════════════════════════════
// HTTP SERVER & ROUTING
// ══════════════════════════════════════════
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // ── API: Status ──
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      api_configured: !!API_KEY,
      stripe_configured: !!(STRIPE_SECRET && (STRIPE_PRICE_BOOK || STRIPE_PRICE_BUNDLE)),
      model: MODEL,
      stats: db.stats,
    }));
    return;
  }

  // ── API: Family GPT Chat ──
  if (pathname === '/api/chat' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const { messages } = JSON.parse(body);
        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'messages array required' }));
          return;
        }
        callClaudeAPI(messages, (err, response) => {
          if (err) {
            console.error('Claude API error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ response }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── API: Save Signup ──
  if (pathname === '/api/signup' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const { type, data } = JSON.parse(body);
        if (!type || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'type and data required' }));
          return;
        }
        const entry = addSignup(type, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, entry, stats: db.stats }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── API: Get All Signups (admin dashboard — password protected) ──
  if (pathname === '/api/signups' && req.method === 'GET') {
    const pw = req.headers['x-admin-password'] || query.pw || '';
    if (pw && pw !== ADMIN_PASSWORD) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Incorrect password' }));
      return;
    }

    const typeFilter = query.type || 'all';
    const search = (query.search || '').toLowerCase();
    let results = db.signups;

    if (typeFilter !== 'all') {
      results = results.filter(s => s.type === typeFilter);
    }
    if (search) {
      results = results.filter(s => {
        const text = JSON.stringify(s).toLowerCase();
        return text.includes(search);
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      signups: results.slice().reverse(),
      stats: db.stats,
      total: results.length,
    }));
    return;
  }

  // ── API: Export CSV (password protected) ──
  if (pathname === '/api/export' && req.method === 'GET') {
    const pw = query.pw || '';
    if (pw && pw !== ADMIN_PASSWORD) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Incorrect password');
      return;
    }

    const typeFilter = query.type || 'all';
    let results = typeFilter === 'all' ? db.signups : db.signups.filter(s => s.type === typeFilter);

    const allKeys = new Set();
    results.forEach(s => Object.keys(s).forEach(k => allKeys.add(k)));
    const keys = ['type', 'date', 'time', ...([...allKeys].filter(k => !['type', 'date', 'time'].includes(k)))];

    let csv = keys.map(k => k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')).join(',') + '\n';
    results.forEach(s => {
      csv += keys.map(k => '"' + (s[k] || '').toString().replace(/"/g, '""') + '"').join(',') + '\n';
    });

    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="growinguptogether-signups-' + new Date().toISOString().slice(0, 10) + '.csv"',
    });
    res.end(csv);
    return;
  }

  // ── API: Stripe Checkout ──
  if (pathname === '/api/checkout' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const { email, name, package: packageType } = JSON.parse(body);
        const pkg = packageType || 'book';
        if (!email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email required' }));
          return;
        }

        const priceId = pkg === 'bundle' ? STRIPE_PRICE_BUNDLE : STRIPE_PRICE_BOOK;
        if (!STRIPE_SECRET || !priceId) {
          // Stripe not configured — save signup without payment
          const entry = addSignup('book', { name, email, package: pkg, paid: false, note: 'Stripe not configured — free signup' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, mode: 'free', entry }));
          return;
        }

        createStripeCheckout(email, name, pkg, (err, session) => {
          if (err) {
            console.error('Stripe error:', err.message);
            // Still save the signup even if Stripe fails
            const entry = addSignup('book', { name, email, package: pkg, paid: false, note: 'Stripe error: ' + err.message });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, mode: 'free', entry }));
          } else {
            // Save signup with pending payment
            addSignup('book', { name, email, package: pkg, paid: false, stripe_session: session.id });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, mode: 'stripe', checkout_url: session.url }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── Payment success page ──
  if (pathname === '/payment-success') {
    const sessionId = query.session_id;
    // Mark payment as completed in database
    if (sessionId) {
      const entry = db.signups.find(s => s.stripe_session === sessionId);
      if (entry) {
        entry.paid = true;
        entry.paid_at = new Date().toISOString();
        db.stats.payments = db.signups.filter(s => s.type === 'book' && s.paid).length;
        saveDB();
        console.log(`[PAYMENT] Completed: ${entry.email}`);
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Thank You!</title>
    <style>body{font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#faf8f5;color:#1a1a2e;text-align:center;}
    .box{max-width:500px;padding:3rem;}.check{font-size:4rem;margin-bottom:1rem;}h1{font-size:2rem;margin-bottom:1rem;}p{font-size:1.1rem;line-height:1.7;color:#666;}
    a{color:#c0392b;font-weight:600;}</style></head><body><div class="box"><div class="check">&#10003;</div>
    <h1>Thank You!</h1><p>Your advance copy of <strong>Growing Up Together</strong> is reserved. We will notify you at your email when it is ready for download.</p>
    <p style="margin-top:2rem;"><a href="/">Return to GrowingUpTogether.ai</a></p></div></body></html>`);
    return;
  }

  // ── Static files ──
  let filePath = pathname === '/' || pathname === '' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveStatic(filePath, res);
});

server.listen(PORT, () => {
  // Initialize email transporter on startup
  initEmailTransporter();

  const sCount = db.stats.total;
  const emailStatus = emailTransporter ? 'Connected ✓                ' : 'Not configured (add .env)  ';
  console.log('');
  console.log('  ╔════════════════════════════════════════════════════╗');
  console.log('  ║      GrowingUpTogether.ai — Server Running        ║');
  console.log('  ╠════════════════════════════════════════════════════╣');
  console.log(`  ║  URL:      http://localhost:${PORT}                   ║`);
  console.log(`  ║  AI:       ${API_KEY ? 'Claude connected ✓           ' : 'Not configured (add .env)  '}      ║`);
  console.log(`  ║  Stripe:   ${STRIPE_SECRET && (STRIPE_PRICE_BOOK || STRIPE_PRICE_BUNDLE) ? 'Connected ✓                ' : 'Not configured (add .env)  '}      ║`);
  console.log(`  ║  Email:    ${emailStatus}      ║`);
  console.log(`  ║  Database: ${sCount} signups stored              ${sCount < 10 ? ' ' : ''}      ║`);
  console.log('  ║                                                    ║');
  console.log('  ║  Dashboard: http://localhost:' + PORT + '/#admin            ║');
  console.log('  ╚════════════════════════════════════════════════════╝');
  console.log('');
});
