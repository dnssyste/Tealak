const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are analyzing delivery sticker photos for a transport company. Extract ALL text from the sticker labels. Return a JSON object with these fields: tur_nr, order_nr, customer_name, address, product, delivery_date (YYYY-MM-DD format), antal (count as number), pos_nr, production, barcode. If multiple stickers, return an array. If a field cannot be read, set it to null.`;

async function analyzePhotos(imagePaths) {
  // Build content array with images
  const content = [
    { type: 'text', text: 'Please analyze these delivery sticker photos and extract all information.' }
  ];

  for (const imgPath of imagePaths) {
    try {
      const imageBuffer = fs.readFileSync(imgPath);
      const base64 = imageBuffer.toString('base64');
      const ext = path.extname(imgPath).toLowerCase();
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';

      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
          detail: 'high'
        }
      });
    } catch (err) {
      console.error(`Failed to read image ${imgPath}:`, err.message);
    }
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content }
    ],
    max_tokens: 2000,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const text = response.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(text);
    // If the response wraps results in a key, extract it
    if (parsed.results && Array.isArray(parsed.results)) {
      parsed = parsed.results;
    } else if (parsed.stickers && Array.isArray(parsed.stickers)) {
      parsed = parsed.stickers;
    }
  } catch (e) {
    console.error('Failed to parse AI response:', text);
    throw new Error('AI returned invalid JSON');
  }

  return parsed;
}

module.exports = { analyzePhotos };
