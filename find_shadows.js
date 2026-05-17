const fs = require('fs');

const content = fs.readFileSync('styles.css', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes('box-shadow') && i + 1 > 2811) {
    console.log((i + 1) + ': ' + line.trim());
  }
});
