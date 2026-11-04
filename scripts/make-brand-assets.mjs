// Makes the app and installer images from the logo in the project root ("Taqseem Logo.png"):
//   public/brand/taqseem-logo.png   full logo with the name (login page, sidebar)
//   src/app/icon.png, apple-icon.png, favicon.ico   browser tab and home-screen icons (the cube)
//   installer/assets/taqseem.ico, taqseem-start.ico, taqseem-stop.ico   setup, Start menu, desktop
// Small icons use only the cube: the name is unreadable at 16-48 px. Run again after changing the
// logo: `node scripts/make-brand-assets.mjs`.

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// sharp comes with Next.js; resolve it from there (it is not a direct dependency).
const requireFromNext = createRequire(createRequire(join(root, "package.json")).resolve("next"));
const sharp = requireFromNext("sharp");

const source = join(root, "Taqseem Logo.png");
const out = (path) => join(root, path);
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function save(path, buffer) {
  await mkdir(dirname(out(path)), { recursive: true });
  await writeFile(out(path), buffer);
  console.log("wrote", path);
}

// The cube and arrows: the logo above its name, cropped to what is drawn, on a square canvas.
async function mark() {
  const meta = await sharp(source).metadata();
  const top = await sharp(source)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * 0.66) })
    .toBuffer();
  const trimmed = await sharp(top).trim({ threshold: 10 }).toBuffer();
  const t = await sharp(trimmed).metadata();
  const side = Math.round(Math.max(t.width, t.height) * 1.06);
  return sharp({ create: { width: side, height: side, channels: 4, background: CLEAR } })
    .composite([{ input: trimmed, gravity: "center" }])
    .png()
    .toBuffer();
}

const png = (input, size) =>
  sharp(input).resize(size, size, { fit: "contain", background: CLEAR }).png().toBuffer();

/** A Windows .ico holding PNG images (fine for Windows Vista and later, and browsers). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((img) => img.data)]);
}

async function icoOf(input, sizes) {
  return ico(
    await Promise.all(sizes.map(async (size) => ({ size, data: await png(input, size) }))),
  );
}

/** The cube with a round badge in the corner: green "play" to start, red "stop" to stop. */
async function badged(cube, kind) {
  const size = 256;
  const r = 52;
  const cx = size - r - 4;
  const cy = size - r - 4;
  const symbol =
    kind === "start"
      ? `<polygon points="${cx - 16},${cy - 24} ${cx - 16},${cy + 24} ${cx + 24},${cy}" fill="#fff"/>`
      : `<rect x="${cx - 19}" y="${cy - 19}" width="38" height="38" rx="4" fill="#fff"/>`;
  const badge = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${kind === "start" ? "#16a34a" : "#dc2626"}" stroke="#fff" stroke-width="8"/>
      ${symbol}
    </svg>`,
  );
  return sharp(await png(cube, size))
    .composite([{ input: badge }])
    .png()
    .toBuffer();
}

const cube = await mark();
const full = await sharp(source).trim({ threshold: 10 }).toBuffer();
await save(
  "public/brand/taqseem-logo.png",
  await sharp(full).resize({ width: 480 }).png().toBuffer(),
);
await save("public/brand/taqseem-mark.png", await png(cube, 256));
await save("src/app/icon.png", await png(cube, 512));
// Home-screen icon: iOS shows transparency as black, so on white.
await save(
  "src/app/apple-icon.png",
  await sharp(await png(cube, 160))
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer(),
);
await save("src/app/favicon.ico", await icoOf(cube, [16, 32, 48]));
const SIZES = [16, 24, 32, 48, 64, 128, 256];
await save("installer/assets/taqseem.ico", await icoOf(cube, SIZES));
await save("installer/assets/taqseem-start.ico", await icoOf(await badged(cube, "start"), SIZES));
await save("installer/assets/taqseem-stop.ico", await icoOf(await badged(cube, "stop"), SIZES));
