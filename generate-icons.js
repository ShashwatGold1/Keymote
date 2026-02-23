const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ANDROID_RES = path.join(ROOT, 'keymote-app', 'android', 'app', 'src', 'main', 'res');
const LOGO_SVG = path.join(ROOT, 'logo-source', 'Group1.svg');

const DENSITIES = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

const LAUNCHER_BASE = 48;
const FOREGROUND_BASE = 108;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Render the logo centered on a white rounded-rect background at given size
async function renderAppIcon(size) {
  const svgBuffer = fs.readFileSync(LOGO_SVG);
  // Increase padding from 0.33 to 0.38 to make logo ~15% smaller relative to frame
  const padding = Math.round(size * 0.38);
  const logoArea = size - padding * 2;

  const logoRendered = await sharp(svgBuffer, { density: 384 })
    .resize(logoArea, logoArea, { fit: 'inside' })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logoRendered).metadata();
  const left = Math.round((size - logoMeta.width) / 2);
  const top = Math.round((size - logoMeta.height) / 2);

  // White background with rounded corners
  const radius = Math.round(size * 0.18);
  const bgSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>`
  );

  const bg = await sharp(bgSvg).png().toBuffer();
  return sharp(bg)
    .composite([{ input: logoRendered, left, top }])
    .png()
    .toBuffer();
}

async function generateLauncherIcons() {
  console.log('=== Generating Launcher Icons ===');

  for (const [density, multiplier] of Object.entries(DENSITIES)) {
    const size = Math.round(LAUNCHER_BASE * multiplier);
    const dir = path.join(ANDROID_RES, `mipmap-${density}`);
    ensureDir(dir);

    const iconBuffer = await renderAppIcon(size);

    // Square launcher
    await sharp(iconBuffer).toFile(path.join(dir, 'ic_launcher.png'));
    console.log(`  ${density}: ic_launcher.png (${size}x${size})`);

    // Round launcher (circular mask)
    const roundMask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`
    );
    await sharp(iconBuffer)
      .composite([{ input: await sharp(roundMask).resize(size, size).png().toBuffer(), blend: 'dest-in' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));
    console.log(`  ${density}: ic_launcher_round.png (${size}x${size})`);
  }
}

async function generateForegroundIcons() {
  console.log('\n=== Generating Adaptive Icon Foreground ===');
  const svgBuffer = fs.readFileSync(LOGO_SVG);

  for (const [density, multiplier] of Object.entries(DENSITIES)) {
    const size = Math.round(FOREGROUND_BASE * multiplier);
    const dir = path.join(ANDROID_RES, `mipmap-${density}`);
    ensureDir(dir);

    // Decrease safeZone from 0.66 to 0.56 to make logo ~15% smaller
    const safeZone = Math.round(size * 0.56);
    const logoRendered = await sharp(svgBuffer, { density: 384 })
      .trim() // Ensure no extra whitespace in source SVG
      .resize(safeZone, safeZone, { fit: 'inside' })
      .png()
      .toBuffer();

    const meta = await sharp(logoRendered).metadata();
    const left = Math.round((size - meta.width) / 2);
    const top = Math.round((size - meta.height) / 2);

    await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([{ input: logoRendered, left, top }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log(`  ${density}: ic_launcher_foreground.png (${size}x${size})`);
  }
}

async function generateDesktopIcon() {
  console.log('\n=== Generating Desktop Icon (transparent) ===');
  ensureDir(path.join(ROOT, 'assets'));
  const svgBuffer = fs.readFileSync(LOGO_SVG);

  const info = await sharp(svgBuffer, { density: 384 })
    .trim() // Trim increases visual size by 25% if there was padding
    .resize(512, null, { fit: 'inside' })
    .png()
    .toFile(path.join(ROOT, 'assets', 'icon.png'));
  console.log(`  assets/icon.png (${info.width}x${info.height})`);

  // Tray icon — 100x100, logo fills more of the space so it's visible at small size
  const traySize = 100;
  const trayLogo = await sharp(svgBuffer, { density: 384 })
    .trim()
    .resize(traySize, null, { fit: 'inside' })
    .png()
    .toBuffer();
  const trayMeta = await sharp(trayLogo).metadata();
  const trayLeft = Math.round((traySize - trayMeta.width) / 2);
  const trayTop = Math.round((traySize - trayMeta.height) / 2);
  await sharp({
    create: { width: traySize, height: traySize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: trayLogo, left: trayLeft, top: trayTop }])
    .png()
    .toFile(path.join(ROOT, 'assets', 'tray-icon.png'));
  console.log(`  assets/tray-icon.png (${traySize}x${traySize})`);
}

async function generateFavicon() {
  console.log('\n=== Generating Favicon (transparent) ===');
  const svgBuffer = fs.readFileSync(LOGO_SVG);

  const info = await sharp(svgBuffer, { density: 384 })
    .trim()
    .resize(256, null, { fit: 'inside' }) // Increased from 64 for "bigger" look
    .png()
    .toFile(path.join(ROOT, 'assets', 'favicon.png'));
  console.log(`  assets/favicon.png (${info.width}x${info.height})`);
}

async function generatePWAIcons() {
  console.log('\n=== Generating PWA Icons ===');
  const srcDir = path.join(ROOT, 'keymote-app', 'src');

  const icon192 = await renderAppIcon(192);
  await sharp(icon192).toFile(path.join(srcDir, 'icon-192.png'));
  console.log('  keymote-app/src/icon-192.png (192x192)');

  const icon512 = await renderAppIcon(512);
  await sharp(icon512).toFile(path.join(srcDir, 'icon-512.png'));
  console.log('  keymote-app/src/icon-512.png (512x512)');

  // Copy SVG
  fs.copyFileSync(
    path.join(ROOT, 'logo-source', 'Keymote_svg.svg'),
    path.join(srcDir, 'icon.svg')
  );
  console.log('  keymote-app/src/icon.svg (copied)');
}

async function generateInAppLogo() {
  console.log('\n=== Generating In-App Logo (transparent) ===');
  const svgBuffer = fs.readFileSync(LOGO_SVG);
  const srcDir = path.join(ROOT, 'keymote-app', 'src');

  const info = await sharp(svgBuffer, { density: 384 })
    .resize(512, null, { fit: 'inside' })
    .png()
    .toFile(path.join(srcDir, 'logo.png'));
  console.log(`  keymote-app/src/logo.png (${info.width}x${info.height})`);
}

async function generateFullLogo() {
  console.log('\n=== Generating Full Logo (with background) ===');
  const svgBuffer = fs.readFileSync(path.join(ROOT, 'logo-source', 'Keymote_svg.svg'));
  const srcDir = path.join(ROOT, 'keymote-app', 'src');

  await sharp(svgBuffer, { density: 384 })
    .resize(512, 512)
    .png()
    .toFile(path.join(srcDir, 'keymote-full.png'));
  console.log('  keymote-app/src/keymote-full.png (512x512)');
}

async function generateSplashScreens() {
  console.log('\n=== Generating Splash Screens ===');
  // Use full logo (with gradient background) for splash screens
  const fullIconSvg = fs.readFileSync(path.join(ROOT, 'logo-source', 'Keymote_svg.svg'));

  const splashSizes = {
    'drawable': { w: 320, h: 480 },
    'drawable-port-mdpi': { w: 320, h: 480 },
    'drawable-port-hdpi': { w: 480, h: 800 },
    'drawable-port-xhdpi': { w: 720, h: 1280 },
    'drawable-port-xxhdpi': { w: 960, h: 1600 },
    'drawable-port-xxxhdpi': { w: 1280, h: 1920 },
    'drawable-land-mdpi': { w: 480, h: 320 },
    'drawable-land-hdpi': { w: 800, h: 480 },
    'drawable-land-xhdpi': { w: 1280, h: 720 },
    'drawable-land-xxhdpi': { w: 1600, h: 960 },
    'drawable-land-xxxhdpi': { w: 1920, h: 1280 },
  };

  for (const [folder, { w, h }] of Object.entries(splashSizes)) {
    const dir = path.join(ANDROID_RES, folder);
    ensureDir(dir);

    // White background
    const bg = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png().toBuffer();

    // Full icon at ~40% of smaller dimension
    const iconSize = Math.round(Math.min(w, h) * 0.4);
    const iconRendered = await sharp(fullIconSvg, { density: 384 })
      .resize(iconSize, iconSize, { fit: 'inside' })
      .png()
      .toBuffer();

    const iconMeta = await sharp(iconRendered).metadata();
    const left = Math.round((w - iconMeta.width) / 2);
    const top = Math.round((h - iconMeta.height) / 2);

    await sharp(bg)
      .composite([{ input: iconRendered, left, top }])
      .png()
      .toFile(path.join(dir, 'splash.png'));
    console.log(`  ${folder}/splash.png (${w}x${h})`);
  }
}

async function main() {
  console.log('Keymote Icon Generator\n');
  try {
    await generateLauncherIcons();
    await generateForegroundIcons();
    await generateDesktopIcon();
    await generateFavicon();
    await generatePWAIcons();
    await generateInAppLogo();
    await generateFullLogo();
    await generateSplashScreens();
    console.log('\nAll icons generated successfully!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
