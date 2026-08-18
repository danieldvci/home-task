// Generates PWA icons into public/icons from an inline SVG source.
// Run with: node scripts/generate-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join(process.cwd(), 'public', 'icons');
const GREEN = '#A1C181';
const CREAM = '#FAF9F6';
const INK = '#3D3732';

/** @param {{bg:string, pad:number}} opts */
function svg({ bg, pad }) {
  const size = 512;
  const inner = size - pad * 2;
  const cardX = pad + inner * 0.16;
  const cardY = pad + inner * 0.12;
  const cardW = inner * 0.68;
  const cardH = inner * 0.76;
  const lineX = cardX + cardW * 0.3;
  const rows = [0.24, 0.46, 0.68].map((t) => cardY + cardH * t);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${inner * 0.09}" fill="${CREAM}"/>
  ${rows
    .map(
      (y) => `
  <path d="M ${cardX + cardW * 0.12} ${y} l ${cardW * 0.07} ${cardW * 0.07} l ${cardW * 0.13} -${cardW * 0.14}"
        fill="none" stroke="${GREEN}" stroke-width="${inner * 0.045}" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${lineX}" y="${y - inner * 0.028}" width="${cardW * 0.5}" height="${inner * 0.055}" rx="${inner * 0.028}" fill="${INK}" opacity="0.28"/>`
    )
    .join('')}
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const standard = Buffer.from(svg({ bg: GREEN, pad: 44 }));
  // Maskable icons need their content inside a safe zone, so pad more.
  const maskable = Buffer.from(svg({ bg: GREEN, pad: 104 }));

  const jobs = [
    ['icon-192.png', standard, 192],
    ['icon-512.png', standard, 512],
    ['icon-maskable-512.png', maskable, 512],
    ['apple-touch-icon.png', Buffer.from(svg({ bg: GREEN, pad: 40 })), 180]
  ];

  for (const [name, source, size] of jobs) {
    const buf = await sharp(source).resize(size, size).png().toBuffer();
    await writeFile(path.join(OUT, name), buf);
    console.log(`wrote public/icons/${name} (${size}x${size}, ${buf.length} bytes)`);
  }

  const favicon = await sharp(standard).resize(48, 48).png().toBuffer();
  await writeFile(path.join(process.cwd(), 'public', 'favicon.png'), favicon);
  console.log('wrote public/favicon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
