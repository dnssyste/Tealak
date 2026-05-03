const fs = require('fs');
const file = '/nvme/data/srv/appdata/teslak-delivery/public/js/app.js';
let code = fs.readFileSync(file, 'utf8');

// All 6 file button IDs and their associated input IDs
const pairs = [
  ['camera-input-file-btn', 'camera-input-files'],
  ['add-photo-input-file-btn', 'add-photo-input-files'],
  ['cont-photo-input-file-btn', 'cont-photo-input-files'],
  ['dmg-sticker-input-file-btn', 'dmg-sticker-input-files'],
  ['dmg-damage-input-file-btn', 'dmg-damage-input-files'],
  ['dc-photo-input-file-btn', 'dc-photo-input-files']
];

pairs.forEach(([btnId, inputId]) => {
  // Replace <button> with <label for="inputId"> in the HTML generation
  // Pattern: '<button type="button" class="btn btn-secondary" id="BTNID" style="...">📁 ...text... </button>'
  const btnRegex = new RegExp(
    `'<button type="button" class="btn btn-secondary" id="${btnId}" style="([^"]*)">([^<]*)</button>'`,
    'g'
  );
  const before = code;
  code = code.replace(btnRegex, (match, style, text) => {
    return `'<label for="${inputId}" class="btn btn-secondary" id="${btnId}" style="${style}cursor:pointer;">${text}</label>'`;
  });
  if (code !== before) {
    console.log('Converted button to label:', btnId);
  } else {
    console.log('Pattern not matched for:', btnId, '- trying alt');
  }

  // Remove the JS click handler that does .click() since label handles it natively
  const clickRegex = new RegExp(
    `document\\.getElementById\\('${btnId}'\\)\\.addEventListener\\('click', function\\(\\)\\s*\\{[^}]*\\}\\);`,
    'g'
  );
  const before2 = code;
  code = code.replace(clickRegex, `// label for=${inputId} handles click natively`);
  if (code !== before2) {
    console.log('Removed click handler:', btnId);
  } else {
    console.log('Click handler pattern not matched for:', btnId);
  }
});

fs.writeFileSync(file, code, 'utf8');
console.log('Done!');
