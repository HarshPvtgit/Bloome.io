/**
 * Bloomé — Google Apps Script Web App
 * Appends one row per paid order to your Google Sheet. This runs entirely
 * inside your own Google account — no API key or credential ever needs to
 * live in the website's code.
 *
 * SHEET: https://docs.google.com/spreadsheets/d/1xoDkaqrZJTd6aWWStvMwtNFOoz0yVA1nA6W3N7ipgoQ/edit
 *
 * ── SETUP ──────────────────────────────────────────────────────────────
 * 1. Open the Google Sheet above.
 * 2. Extensions → Apps Script. Delete any starter code, paste this whole
 *    file in, and save (Ctrl/Cmd+S). Name the project "Bloomé Orders".
 * 3. In the Sheet itself, rename the first tab to "Orders" (or change the
 *    SHEET_NAME constant below to match your tab name).
 * 4. In row 1 of that tab, add these headers, one per column, A→W:
 *    Order ID | Date | Time | Customer Name | Phone | Email | Address |
 *    City | State | Pincode | Flowers | Flower Quantities | Wrap |
 *    Wrap Color | Ribbon | Flower Subtotal | Wrap Price | Ribbon Price |
 *    GST | Delivery Charge | Grand Total | Payment Method |
 *    Payment Status | Order Status
 * 5. In the Apps Script editor: Deploy → New deployment → gear icon →
 *    "Web app".
 *      - Description: "Bloomé order sync"
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Click Deploy, authorize it with your Google account when prompted.
 * 6. Copy the "Web app URL" it gives you (ends in /exec).
 * 7. Paste that URL into `SHEET_WEBAPP_URL` near the top of bloome.html's
 *    <script> section, e.g.
 *      const SHEET_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
 * 8. Re-save/re-host bloome.html. Every paid order will now add a row.
 *
 * If you ever edit this script, you must create a NEW deployment (or use
 * "Manage deployments" → edit → new version) for changes to take effect —
 * saving alone doesn't update a live Web App URL.
 * ─────────────────────────────────────────────────────────────────────
 */

const SHEET_NAME = 'Orders';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    sheet.appendRow([
      data.orderId || '',
      data.date || '',
      data.time || '',
      data.customerName || '',
      data.phone || '',
      data.email || '',
      data.address || '',
      data.city || '',
      data.state || '',
      data.pincode || '',
      data.flowers || '',
      data.flowerQuantities || '',
      data.wrap || '',
      data.wrapColor || '',
      data.ribbon || '',
      data.flowerSubtotal || 0,
      data.wrapPrice || 0,
      data.ribbonPrice || 0,
      data.gst || 0,
      data.deliveryCharge || 0,
      data.grandTotal || 0,
      data.paymentMethod || '',
      data.paymentStatus || '',
      data.orderStatus || 'New Order'
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lets you sanity-check the deployment by visiting the /exec URL directly
// in a browser — should show "Bloomé order sync is live."
function doGet() {
  return ContentService.createTextOutput('Bloomé order sync is live.');
}
