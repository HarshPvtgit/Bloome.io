# Bloomé — Backend Integration Spec

This document describes what a developer needs to build so the `bloome.html`
frontend becomes a real production system: real payments, a real database,
real Google Sheets sync, real WhatsApp order notifications, and real admin
auth. The frontend already implements every screen, calculation, and
validation rule — this spec covers only the server side.

Suggested stack: **Next.js (API routes) + PostgreSQL (Prisma) + Razorpay +
Google Sheets API + WhatsApp Business API**, but any Node/Python/Go backend
works the same way.

---

## 1. Architecture

```
Browser (Bloomé site)
   │
   ├── POST /api/orders/create-payment   → creates a Razorpay order (server)
   ├── POST /api/orders/verify           → verifies payment, writes DB + Sheet row + sends WhatsApp
   ├── GET  /api/products                → public product list (flowers/wraps/ribbons)
   │
   ├── POST /api/admin/login             → returns session/JWT
   ├── GET  /api/admin/orders            → list + filter orders   (auth required)
   ├── PATCH /api/admin/orders/:id       → update order/payment status (auth required)
   ├── PATCH /api/admin/products/:id     → update price/availability (auth required)
   │
Server
   ├── Database (orders, products, wraps, ribbons, admins)
   ├── Razorpay SDK (secret key, webhook secret)
   ├── Google Sheets API (service account)
   └── WhatsApp Business API (Meta Cloud API or Twilio)
```

The browser **never** talks to Razorpay's secret key, the Google service
account credentials, or the WhatsApp API token directly — only to your own
`/api/...` routes.

---

## 2. Database schema (Postgres / Prisma-style)

```prisma
model Flower {
  id        String  @id            // "rose", "tulip", ...
  name      String
  price     Int                    // paise or rupees — pick one unit and stay consistent
  active    Boolean @default(true)
  imageUrl  String?
}

model Wrap {
  id         String  @id
  name       String
  price      Int
  colorable  Boolean @default(false)
  active     Boolean @default(true)
}

model Ribbon {
  id       String  @id
  name     String
  price    Int
  hex      String
  active   Boolean @default(true)
}

model Order {
  id              String   @id @default(cuid())
  orderNumber     String   @unique         // "BLM-20260813-001"
  customerName    String
  phone           String
  email           String
  address         String
  city            String
  state           String
  pincode         String

  flowers         Json     // [{id, name, qty, price}]
  wrapId          String?
  wrapColor       String?
  ribbonId        String?

  flowersSubtotal Int
  wrapPrice       Int
  ribbonPrice     Int
  deliveryFee     Int      @default(49)
  grandTotal      Int

  paymentMethod   String?
  paymentStatus   String   @default("Pending")   // Pending | Paid | Failed | Refunded
  razorpayOrderId String?
  razorpayPaymentId String?

  status          String   @default("New Order") // New Order|Confirmed|Preparing|Ready|Out for Delivery|Delivered|Cancelled
  sheetSynced     Boolean  @default(false)
  ownerNotified   Boolean  @default(false)
  customerNotified Boolean @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Admin {
  id           String @id @default(cuid())
  email        String @unique
  passwordHash String   // bcrypt/argon2 — never store plain text
}
```

---

## 3. Server-side price validation (critical)

The frontend sends *what the customer picked* (flower IDs + quantities, wrap
ID + color, ribbon ID) — **never** a price. On the server:

```js
// /api/orders/create-payment
const { flowers, wrapId, wrapColor, ribbonId } = req.body;

const dbFlowers = await db.flower.findMany({ where: { id: { in: Object.keys(flowers) }, active: true } });
let flowersSubtotal = 0;
for (const f of dbFlowers) flowersSubtotal += f.price * (flowers[f.id] || 0);

const wrap = wrapId ? await db.wrap.findUnique({ where: { id: wrapId } }) : null;
const ribbon = ribbonId ? await db.ribbon.findUnique({ where: { id: ribbonId } }) : null;

const subtotal = flowersSubtotal + (wrap?.price || 0) + (ribbon?.price || 0);
const grandTotal = subtotal + 49; // delivery fee, also defined server-side, not from the client
```

Recompute this same total again inside the payment verification step before
writing the order — never trust a total posted from the browser.

---

## 4. Payment — Razorpay (recommended for India: UPI, cards, GPay, PhonePe)

### Flow
1. Browser calls `POST /api/orders/create-payment` with the cart selections
   (not prices) and customer details.
2. Server recalculates the total (§3), creates a Razorpay order, and returns
   `{ razorpayOrderId, amount, key: RAZORPAY_KEY_ID }` to the browser.
3. Browser opens Razorpay Checkout with that order ID.
4. On success, Razorpay returns `razorpay_payment_id`, `razorpay_order_id`,
   `razorpay_signature` to the browser, which posts them to
   `POST /api/orders/verify`.
5. Server verifies the HMAC signature, marks the order `Paid`, writes the DB
   row, appends the Google Sheet row, and sends the two WhatsApp messages
   (owner + customer) — see §6 and §7.
6. Server also exposes a **webhook** endpoint so payment confirmation isn't
   solely dependent on the browser staying open.

```js
// server-side signature check
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
  .update(`${razorpay_order_id}|${razorpay_payment_id}`)
  .digest('hex');
if (expected !== razorpay_signature) return res.status(400).send('Invalid signature');
```

Other Indian gateways (Cashfree, PayU, Stripe India) follow the same
create-order → client-checkout → server-verify → webhook pattern.

---

## 5. Order ID generation (server-side, race-safe)

Don't generate `BLM-YYYYMMDD-NNN` by counting rows read into the browser —
do it inside a DB transaction so two simultaneous orders can't collide:

```sql
SELECT COUNT(*) FROM "Order" WHERE "orderNumber" LIKE 'BLM-20260813-%' FOR UPDATE;
```

---

## 6. Google Sheets sync

Your sheet: `https://docs.google.com/spreadsheets/d/1xoDkaqrZJTd6aWWStvMwtNFOoz0yVA1nA6W3N7ipgoQ/edit`
→ **Spreadsheet ID:** `1xoDkaqrZJTd6aWWStvMwtNFOoz0yVA1nA6W3N7ipgoQ`

### Setup
1. Google Cloud Console → create/select a project → enable the **Google
   Sheets API**.
2. Create a **service account** → generate a JSON key.
3. Open the sheet above → **Share** → paste the service account's email
   (looks like `bloome-sheets@your-project.iam.gserviceaccount.com`) and give
   it **Editor** access. Without this share step, writes will fail even with
   a valid key.
4. In row 1 of a tab named `Orders`, add these headers (matches the columns
   in the original brief):

```
Order ID | Date | Time | Customer Name | Phone | Email | Address | City | State
| Pincode | Flowers | Flower Quantities | Wrap | Wrap Color | Ribbon
| Flower Subtotal | Wrap Price | Ribbon Price | Delivery Charge | Grand Total
| Payment Method | Payment Status | Order Status
```

### Append a row after a paid order

```js
const { google } = require('googleapis');

async function appendOrderToSheet(order) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const created = new Date(order.createdAt);

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID, // 1xoDkaqrZJTd6aWWStvMwtNFOoz0yVA1nA6W3N7ipgoQ
    range: 'Orders!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        order.orderNumber,
        created.toLocaleDateString('en-IN'),
        created.toLocaleTimeString('en-IN'),
        order.customerName, order.phone, order.email,
        order.address, order.city, order.state, order.pincode,
        order.flowers.map(f => f.name).join(', '),
        order.flowers.map(f => `${f.name} x${f.qty}`).join(', '),
        order.wrapName || '', order.wrapColor || '', order.ribbonName || '',
        order.flowersSubtotal, order.wrapPrice, order.ribbonPrice,
        order.deliveryFee, order.grandTotal,
        order.paymentMethod, order.paymentStatus, order.status,
      ]],
    },
  });
}
```

Call `appendOrderToSheet(order)` inside `/api/orders/verify`, right after the
order is marked `Paid` in the database. Treat the Sheet as a reporting mirror
— the database stays the source of truth; if a Sheets write fails, log it and
retry later rather than blocking the customer's confirmation screen.

*(Apps Script alternative: deploy a small Apps Script web app that accepts a
POST and writes the row itself; your server `fetch()`s that URL with a shared
secret instead of using the Sheets API directly. Simpler to set up, slightly
less flexible.)*

---

## 7. WhatsApp notifications (owner + customer)

Two messages go out the moment `/api/orders/verify` confirms payment:

- **To the owner** (`+91 7208713559`) — full order details, so they can
  start preparing the bouquet immediately.
- **To the customer** (the mobile number they entered at checkout) — a
  confirmation that their order and payment went through.

### Choosing a provider
WhatsApp doesn't let a server send arbitrary free-form messages to a number
that hasn't messaged you in the last 24 hours — business-initiated messages
(like an order confirmation) must use a **pre-approved message template**.
Two practical ways to get this:

- **Meta WhatsApp Cloud API** — free, but requires a verified Meta Business
  account/WhatsApp Business Platform setup and template approval (usually
  takes a few hours to a couple of days).
- **Twilio WhatsApp API** (or Gupshup/AiSensy) — same underlying WhatsApp
  rules, but faster to get started with and a friendlier dashboard for
  submitting templates; costs a small per-message fee.

Either way you'll submit two templates for approval:

**`order_notify_owner`** (to +91 7208713559)
```
New Bloomé order {{1}}
Customer: {{2}} ({{3}})
Address: {{4}}, {{5}}, {{6}} - {{7}}
Bouquet: {{8}}
Wrap: {{9}} | Ribbon: {{10}}
Total: ₹{{11}} — Payment: {{12}}
```

**`order_confirm_customer`** (to the customer's number)
```
Hi {{1}}, your Bloomé order {{2}} is confirmed and payment of ₹{{3}} was
received. Your bouquet ({{4}}) is being handcrafted and will be delivered
to your address in {{5}}. We'll reach out on this number if we need
anything. — Team Bloomé 🌸
```

### Sending via Meta WhatsApp Cloud API

```js
async function sendWhatsAppTemplate(to, templateName, params) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to, // e.g. "917208713559" — country code, no "+", no spaces
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [{
            type: 'body',
            parameters: params.map(text => ({ type: 'text', text: String(text) })),
          }],
        },
      }),
    }
  );
  if (!res.ok) console.error('WhatsApp send failed', await res.text());
}

async function notifyOrderByWhatsApp(order) {
  const flowersText = order.flowers.map(f => `${f.name} x${f.qty}`).join(', ');

  await sendWhatsAppTemplate(process.env.OWNER_WHATSAPP_NUMBER, 'order_notify_owner', [
    order.orderNumber, order.customerName, order.phone,
    order.address, order.city, order.state, order.pincode,
    flowersText, order.wrapName || '—', order.ribbonName || '—',
    order.grandTotal, order.paymentStatus,
  ]);

  await sendWhatsAppTemplate(`91${order.phone}`, 'order_confirm_customer', [
    order.customerName, order.orderNumber, order.grandTotal,
    flowersText, order.city,
  ]);
}
```

Call `notifyOrderByWhatsApp(order)` in `/api/orders/verify`, right after the
Sheets write. Wrap both the Sheets call and this call in try/catch so a
notification failure never blocks the customer's confirmation screen —
log failures and retry from a background job instead.

*(Twilio alternative: same idea, using
`client.messages.create({ from: 'whatsapp:+14155238886', to: 'whatsapp:+917208713559', contentSid: '...' })`
with your approved Content Template SID in place of `templateName`.)*

---

## 8. Admin authentication

Replace the prototype's client-side password with real auth:

- Store `Admin.passwordHash` using bcrypt or argon2 — never plain text.
- `POST /api/admin/login` checks the hash, then issues a signed, httpOnly,
  secure session cookie or short-lived JWT (`ADMIN_SESSION_SECRET`).
- Every `/api/admin/*` route checks that cookie/JWT server-side before
  reading or mutating anything — don't rely on hiding the admin link in the UI.
- Rate-limit login attempts.

---

## 9. Environment variables to configure

```
DATABASE_URL=postgres://...

RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

GOOGLE_SERVICE_ACCOUNT_JSON=...      # full JSON, base64 or escaped
GOOGLE_SHEET_ID=1xoDkaqrZJTd6aWWStvMwtNFOoz0yVA1nA6W3N7ipgoQ

WHATSAPP_PHONE_NUMBER_ID=...         # from Meta Business/WhatsApp setup
WHATSAPP_ACCESS_TOKEN=...
OWNER_WHATSAPP_NUMBER=917208713559   # country code, no "+", no spaces

ADMIN_SESSION_SECRET=...             # long random string
NEXT_PUBLIC_APP_URL=https://bloome.example.com
```

None of these should ever appear in frontend JavaScript, be committed to git,
or be logged. Load them via your hosting platform's secret manager (Vercel/
Render/Railway env vars, AWS Secrets Manager, etc.).

---

## 10. Security checklist

- [ ] All prices recomputed server-side at both order-creation and
      verification time — cart totals from the browser are never trusted.
- [ ] Razorpay signature verified server-side before marking `Paid`.
- [ ] Webhook endpoint configured as a backstop to signature verification.
- [ ] Google Sheet shared with the service account email as Editor.
- [ ] WhatsApp templates pre-approved before going live; sending wrapped in
      try/catch so failures don't block the customer's confirmation screen.
- [ ] Admin routes behind real session/JWT auth, not a hard-coded password.
- [ ] Admin passwords hashed (bcrypt/argon2), never stored plain.
- [ ] All secrets in environment variables, never in frontend code or git.
- [ ] Input validation repeated server-side (phone, pincode, email) — client
      validation is a UX nicety, not a security control.
- [ ] HTTPS enforced everywhere; cookies `Secure` + `httpOnly` + `SameSite`.
- [ ] Rate limiting on `/api/admin/login` and order creation endpoints.
- [ ] Order status transitions logged (who changed what, when) for audit.

---

## 11. Wiring it to the existing frontend

In `bloome.html`, the two integration points are:

1. `submitOrder()` — replace the `setTimeout` mock with:
   - `fetch('/api/orders/create-payment', {...})` → get `razorpayOrderId`
   - open Razorpay Checkout (`https://checkout.razorpay.com/v1/checkout.js`)
   - on success, `fetch('/api/orders/verify', {...})`
   - on response, set `S.lastOrder` from the **server's** returned order
     object (not the client-computed one) and route to the confirmation view.
     The server response is also what triggers the Sheets write and the two
     WhatsApp messages — the browser doesn't need to do anything extra for
     those.

2. Admin views — replace `storeGet/storeSet` calls with `fetch()` calls to
   `/api/admin/orders` and `/api/admin/products`, and replace `adminLogin()`
   with a real `POST /api/admin/login` call that sets a session cookie.

Everything else — the customizer flow, the live SVG bouquet preview, cart
math, validation rules, and the admin UI shape — can stay as-is.
