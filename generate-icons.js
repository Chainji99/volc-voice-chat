const fs = require('fs');
const path = require('path');

// Ensure public/icons directory exists
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Copy icon.svg to icon-192.svg and icon-512.svg
const svgContent = fs.readFileSync(path.join(iconsDir, 'icon.svg'), 'utf8');
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), svgContent);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), svgContent);

console.log('Icons initialized successfully!');
