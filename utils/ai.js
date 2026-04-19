const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STICKER_PROMPT = `Analyze this delivery sticker/label photo in maximum detail. Extract ALL of these fields:
- order_nr: The order number (look for "Order nr", "Ordrenr", "Order", "Bestilling" or similar, e.g. "DK 43219235")
- tur_nr: The tour/route number (look for "Tur nr", "Tur", "Tour", "Rute" or similar, usually a letter followed by digits like "I185", "A23", "B456"). This is NOT the order number.
- customer_name: The recipient/customer name (look for "Modtager", "Kunde", "Recipient", "Name", "Navn" or the name printed near the address)
- address: The FULL delivery address including street, house number, postal code, city, and country if visible
- product: Product description or name (look for "Produkt", "Vare", "Product", "Description", "Beskrivelse", item names, or any product identifiers)
- delivery_date: The delivery date/time shown on the sticker (look for date stamps, "Dato", "Date", "Levering", "Delivery" etc). Use ISO format YYYY-MM-DD or YYYY-MM-DDTHH:mm if time is visible. If no date is visible, use null.
- antal: Quantity/number of items (look for "Antal", "Stk", "Qty", "Quantity", "Kolli", "Pcs" or any count)
- pos_nr: Position number (look for "Pos", "Position", "Pos nr" or similar reference numbers)
- production: Production or batch information (look for "Produktion", "Production", "Batch", "Parti", "Lot" or manufacturing references)
- barcode: Any barcode numbers, tracking numbers, or reference codes visible (look for long numeric sequences, "Ref", "Track", "Stregkode", "SSCC", "EAN")
Extract as much information as possible from the sticker. Read ALL text visible on the label.
Return as JSON: {"order_nr": "...", "tur_nr": "...", "customer_name": "...", "address": "...", "product": "...", "delivery_date": "...", "antal": ..., "pos_nr": "...", "production": "...", "barcode": "..."}
For antal, return as a number (integer). For all other fields, return as strings. If a field cannot be found or read, use null.`;

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
  const isSticker = mode === "sticker";
  const systemPrompt = isSticker ? STICKER_PROMPT : DAMAGE_PROMPT;
  const userText = isSticker ? "Please analyze these delivery sticker photos and extract the requested information." : "Please analyze these damage photos in detail and provide a comprehensive damage assessment report.";
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
