// Package the same Bri vector for the installer, window, Windows tray and Mac menu bar.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const assets = new URL('../desktop/assets/', import.meta.url);
const glyph = await readFile(new URL('character.svg', assets), 'utf8');
if (!glyph.includes('stroke-width="2"')) throw new Error('브리 캐릭터의 선 두께를 확인해 주세요.');
const inner = glyph.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/s, '').trim();
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><title>AI 브릿지</title><rect width="128" height="128" rx="28" fill="#0E0F0C"/><g transform="translate(4 12) scale(2.5)">${inner}</g></svg>\n`;
await writeFile(new URL('icon.svg', assets), tile);
await sharp(Buffer.from(tile)).resize(1024, 1024).png().toFile(fileURLToPath(new URL('icon.png', assets)));

const small = glyph.replace('stroke-width="2"', 'stroke-width="3"');
const template = small.replaceAll('#C6FF3D', '#000000');
for (const [filename, source, size] of [
  ['tray.png', small, 32], ['tray@2x.png', small, 64],
  ['trayTemplate.png', template, 18], ['trayTemplate@2x.png', template, 36],
]) await sharp(Buffer.from(source)).resize(size, size).png().toFile(fileURLToPath(new URL(filename, assets)));

// Modern Windows ICO supports a PNG for each size; include a real 256px frame for NSIS.
const sizes = [16, 24, 32, 48, 128, 256];
const frames = await Promise.all(sizes.map(size => sharp(Buffer.from(tile)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let index = 0; index < sizes.length; index += 1) {
  const entry = 6 + index * 16;
  header[entry] = sizes[index] % 256; header[entry + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}
await writeFile(new URL('icon.ico', assets), Buffer.concat([header, ...frames]));
console.log('Bri: installer/window icon, Windows tray and macOS template images generated.');
