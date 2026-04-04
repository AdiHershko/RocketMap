const fs = require('fs');

function fixFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  let fixed = 0;

  const result = lines.map(line => {
    // Match lines like:   'some name': ... or   'some name':[...
    // We need to find the key between the first ' and the ': pattern
    const start = line.indexOf("'");
    if (start === -1) return line;

    // Find the closing quote that is followed by ': or ':[
    let end = -1;
    for (let i = start + 1; i < line.length - 1; i++) {
      if (line[i] === "'" && (line[i+1] === ':')) {
        end = i;
        break;
      }
    }
    if (end === -1) return line;

    const key = line.slice(start + 1, end);
    if (!key.includes("'")) return line; // no inner quotes, leave as-is

    // Replace with double-quoted key
    fixed++;
    return line.slice(0, start) + '"' + key + '"' + line.slice(end + 1);
  });

  fs.writeFileSync(filePath, result.join('\n'), 'utf8');
  console.log(`Fixed ${fixed} entries in: ${filePath}`);
}

fixFile('src/app/city-coordinates.ts');
fixFile('src/app/city-polygons.ts');
