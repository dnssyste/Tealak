const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STICKER_PROMPT = `You are an expert OCR reader for Nordic logistics delivery labels (INVITA, HTH, Nobia, etc).
Extract exactly these 5 fields:

1. order_nr - Order number. Labeled "Order nr", "Ordrenr", "Bestillingsnr". Examples: "IA 11084669", "DK 43219235". Usually starts with 2 letters.
2. tur_nr - Tour/route number. Labeled "Tur nr" or "Tur". Is a short number or code like "2226" or "I185". DIFFERENT from order_nr.
3. customer_name - Recipient name. The customer or company name printed at the TOP of the address block, BEFORE the street address. Example: "A. Enggaard Byggeplads V15".
4. address - Full delivery address. The street address, city, and postal code BELOW the customer name in the address block. Example: "Poulstrupvej 68, 9330 Dronninglund".
5. delivery_date - Delivery date. Labeled "Delivery day", "Leveringsdato", "Prod dag", "Dato" or similar.
   - Format on label may be YY-MM-DD (e.g. "16-04-26" means 2026-04-16) or DD.MM.YYYY or other variants.
   - Always return as ISO 8601: YYYY-MM-DD. If year is 2 digits (e.g. 26), assume 20XX.
   - Return null only if truly not found.

Return ONLY valid JSON:
{"order_nr": "...", "tur_nr": "...", "customer_name": "...", "address": "...", "delivery_date": "YYYY-MM-DD or null"}`;

const DAMAGE_PROMPT = `You are a freight damage assessment expert. Analyze these photos of damaged/missing delivery items in extreme detail.
Provide a comprehensive damage report including:
- damage_type: Type of damage (crushed, water damage, torn packaging, broken contents, missing items, scratched, dented, punctured)
- severity: Rate as minor, moderate, severe, or critical
- description: Detailed description of ALL visible damage. Be very specific about what parts are damaged and how, size and extent, whether packaging or contents are affected, any visible product/item details, whether items appear salvageable, environmental factors visible
- affected_items: List any identifiable items, products, or package labels visible
- possible_cause: What likely caused the damage
- recommended_action: Suggested next steps
Return as JSON: {"damage_type": "...", "severity": "...", "description": "...", "affected_items": "...", "possible_cause": "...", "recommended_action": "..."}
Be thorough - this report may be used for insurance claims and dispute resolution.`;


const STICKER_FULL_PROMPT = `You are an expert OCR reader for Nordic logistics delivery labels (INVITA, HTH, Nobia, etc).
Extract ALL information visible on the sticker/label. Read every piece of text, number, code, and identifier thoroughly.

Return as JSON with these fields (use null for fields not found):
{
  "order_nr": "Order number (e.g. 'IA 11084669', 'DK 43219235'). Usually starts with 2 letters.",
  "tur_nr": "Tour/route number (e.g. '2226', 'I185'). Labeled Tur nr or Tur.",
  "customer_name": "Recipient/customer name at top of address block",
  "address": "Full delivery address including street, postal code and city",
  "delivery_date": "Delivery date in YYYY-MM-DD format. Convert from any format (YY-MM-DD means 20YY-MM-DD, DD.MM.YYYY, etc). 2-digit year = 20XX. null if not found.",
  "product": "Product description, type, model, or article name",
  "antal": "Quantity/number of items/pieces/colli",
  "pos_nr": "Position number or line number",
  "production": "Production number, batch, or manufacturing code",
  "barcode": "Any barcode or EAN numbers visible (transcribe the digits)",
  "weight": "Weight with unit if shown (e.g. '12.5 kg')",
  "dimensions": "Package dimensions or size if shown",
  "sender": "Sender, shipper, factory, or manufacturer name/address",
  "phone": "Any phone numbers visible",
  "reference": "Any reference numbers, PO numbers, or codes not covered above",
  "notes": "Special handling instructions, delivery notes, or remarks",
  "additional_info": "Any other text or information visible on the sticker not covered by the fields above. Include EVERYTHING you can read."
}

IMPORTANT: Be extremely thorough. Read every single line of text on the label. This is for a damage claim report where complete and accurate information is critical for insurance and dispute resolution.`;

function buildImageContent(imagePaths) {
  const content = [];
  for (const imgPath of imagePaths) {
    try {
      const imageBuffer = fs.readFileSync(imgPath);
      const base64 = imageBuffer.toString("base64");
      const ext = path.extname(imgPath).toLowerCase();
      let mimeType = "image/jpeg";
      if (ext === ".png") mimeType = "image/png";
      else if (ext === ".webp") mimeType = "image/webp";
      content.push({ type: "image_url", image_url: { url: "data:" + mimeType + ";base64," + base64, detail: "high" } });
    } catch (err) {
      console.error("Failed to read image " + imgPath + ":", err.message);
    }
  }
  return content;
}

async function analyzePhotos(imagePaths, mode) {
  mode = mode || "sticker";
  const isSticker = mode === "sticker" || mode === "sticker_full";
  const systemPrompt = mode === "sticker_full" ? STICKER_FULL_PROMPT : (mode === "sticker" ? STICKER_PROMPT : DAMAGE_PROMPT);
  const userText = mode === "sticker_full" ? "Please analyze these delivery sticker photos and extract ALL visible information. Be extremely thorough - read every piece of text on the label." : (isSticker ? "Please analyze these delivery sticker photos and extract the requested information." : "Please analyze these damage photos in detail and provide a comprehensive damage assessment report.");
  const content = [{ type: "text", text: userText }].concat(buildImageContent(imagePaths));
  const response = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: content }], max_tokens: 3000, temperature: 0.1, response_format: { type: "json_object" } });
  const text = response.choices[0].message.content;
  var parsed;
  try {
    parsed = JSON.parse(text);
    if (parsed.results && Array.isArray(parsed.results)) parsed = parsed.results;
    else if (parsed.stickers && Array.isArray(parsed.stickers)) parsed = parsed.stickers;
  } catch (e) {
    console.error("Failed to parse AI response:", text);
    throw new Error("AI returned invalid JSON");
  }
  return parsed;
}

module.exports = { analyzePhotos };
