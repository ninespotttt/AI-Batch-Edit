import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { cp, mkdir, open, readdir, readFile, readlink, rm, stat } from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const require = createRequire(import.meta.url);
const { downloadArtifact } = require('@electron/get');
const yauzl = require('yauzl');
const plist = require('plist');
const sharp = require('sharp');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protectedRoot = path.join(root, 'protected-main');
const outputRoot = path.join(root, 'release-obfuscated');
const stagingRoot = path.join(outputRoot, '.mac-staging');
const productName = '万能AI批量编辑器';
const appId = 'com.zdyr.universalbatch';
const archs = ['x64', 'arm64'];
const firstOpenFixScriptName = '首次打开修复.command';
const universalMacZipName = `${productName}-mac.zip`;
const universalArmDir = '苹果芯片版本';
const universalX64Dir = 'Intel芯片版本';

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

class ZipWriter {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this.fd = fs.openSync(outputPath, 'w');
    this.offset = 0;
    this.central = [];
  }

  write(buffer) {
    fs.writeSync(this.fd, buffer, 0, buffer.length, this.offset);
    this.offset += buffer.length;
  }

  addRaw(entry) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const localOffset = this.offset;
    const method = entry.method ?? 0;
    const versionNeeded = entry.versionNeeded ?? (method === 8 ? 20 : 10);
    const versionMadeBy = entry.versionMadeBy ?? 0x0314;
    const flags = 0x0800;
    const modTime = entry.modTime ?? 0;
    const modDate = entry.modDate ?? 0;
    const crc = entry.crc32 >>> 0;
    const compressedSize = entry.compressedData.length;
    const uncompressedSize = entry.uncompressedSize ?? compressedSize;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(modTime, 10);
    localHeader.writeUInt16LE(modDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize >>> 0, 18);
    localHeader.writeUInt32LE(uncompressedSize >>> 0, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    this.write(localHeader);
    this.write(nameBuffer);
    this.write(entry.compressedData);

    this.central.push({
      nameBuffer,
      versionMadeBy,
      versionNeeded,
      flags,
      method,
      modTime,
      modDate,
      crc,
      compressedSize,
      uncompressedSize,
      externalFileAttributes: entry.externalFileAttributes >>> 0,
      localOffset
    });
  }

  addBuffer(name, buffer, options = {}) {
    const method = options.method ?? (buffer.length > 0 ? 8 : 0);
    const compressedData = method === 8 ? zlib.deflateRawSync(buffer, { level: 9 }) : buffer;
    const { modTime, modDate } = dateToDos(options.date || new Date());
    this.addRaw({
      name,
      method,
      crc32: crc32(buffer),
      compressedData,
      uncompressedSize: buffer.length,
      externalFileAttributes: options.externalFileAttributes ?? externalAttributesForMode(options.mode ?? 0o100644),
      versionMadeBy: 0x0314,
      versionNeeded: method === 8 ? 20 : 10,
      modTime,
      modDate
    });
  }

  addDirectory(name) {
    const normalized = name.endsWith('/') ? name : `${name}/`;
    const { modTime, modDate } = dateToDos(new Date());
    this.addRaw({
      name: normalized,
      method: 0,
      crc32: 0,
      compressedData: Buffer.alloc(0),
      uncompressedSize: 0,
      externalFileAttributes: externalAttributesForMode(0o40755) | 0x10,
      versionMadeBy: 0x0314,
      versionNeeded: 10,
      modTime,
      modDate
    });
  }

  close() {
    const centralStart = this.offset;
    for (const entry of this.central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(entry.versionMadeBy, 4);
      header.writeUInt16LE(entry.versionNeeded, 6);
      header.writeUInt16LE(entry.flags, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.modTime, 12);
      header.writeUInt16LE(entry.modDate, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize >>> 0, 20);
      header.writeUInt32LE(entry.uncompressedSize >>> 0, 24);
      header.writeUInt16LE(entry.nameBuffer.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(entry.externalFileAttributes >>> 0, 38);
      header.writeUInt32LE(entry.localOffset >>> 0, 42);
      this.write(header);
      this.write(entry.nameBuffer);
    }

    const centralSize = this.offset - centralStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(centralSize >>> 0, 12);
    end.writeUInt32LE(centralStart >>> 0, 16);
    end.writeUInt16LE(0, 20);
    this.write(end);
    fs.closeSync(this.fd);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDos(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    modTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    modDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function externalAttributesForMode(mode) {
  return (mode << 16) >>> 0;
}

function toZipPath(value) {
  return value.split(path.sep).join('/');
}

function transformElectronEntryName(fileName) {
  if (!fileName.startsWith('Electron.app/')) return null;
  return `${productName}.app/${fileName.slice('Electron.app/'.length)}`;
}

function requiredSharpPackage(arch) {
  return `sharp-darwin-${arch}`;
}

function requiredLibvipsPackage(arch) {
  return `sharp-libvips-darwin-${arch}`;
}

function fileModeForAppPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.node') || lower.endsWith('.dylib') || lower.endsWith('.so')) return 0o100755;
  return 0o100644;
}

function firstOpenFixScript() {
  return `#!/bin/bash
set -e

cd "$(dirname "$0")"
APP="./${productName}.app"

if [ ! -d "$APP" ]; then
  APP="/Applications/${productName}.app"
fi

if [ ! -d "$APP" ]; then
  echo "没有找到 ${productName}.app"
  echo "请把这个脚本放在 ${productName}.app 旁边，或先把 App 拖到“应用程序”后再运行。"
  echo
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

/usr/bin/xattr -cr "$APP" 2>/dev/null || true
/usr/bin/open "$APP"

echo "已完成首次打开修复，正在打开 ${productName}。"
sleep 2
`;
}

function universalFirstOpenFixScript() {
  return `#!/bin/bash
set -e

cd "$(dirname "$0")"
APP_NAME="${productName}.app"
ARCH="$(/usr/bin/uname -m)"

if [ "$ARCH" = "arm64" ]; then
  APP="./${universalArmDir}/$APP_NAME"
else
  APP="./${universalX64Dir}/$APP_NAME"
fi

if [ ! -d "$APP" ]; then
  echo "没有找到可打开的应用。请重新解压完整压缩包后再运行。"
  echo
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

/usr/bin/xattr -cr "$APP" 2>/dev/null || true
/usr/bin/open "$APP"

echo "已自动选择并打开适合这台 Mac 的版本。"
sleep 2
`;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCompressedData(zipPath, entry) {
  const handle = await open(zipPath, 'r');
  try {
    const header = Buffer.alloc(30);
    await handle.read(header, 0, header.length, entry.relativeOffsetOfLocalHeader);
    if (header.readUInt32LE(0) !== 0x04034b50) {
      throw new Error(`Invalid local header for ${entry.fileName}`);
    }
    const fileNameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataOffset = entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraLength;
    const data = Buffer.alloc(entry.compressedSize);
    if (entry.compressedSize > 0) {
      await handle.read(data, 0, entry.compressedSize, dataOffset);
    }
    return data;
  } finally {
    await handle.close();
  }
}

async function readZipEntryBuffer(zipPath, fileName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (entry.fileName !== fileName) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            zipFile.close();
            reject(streamError);
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', (error) => {
            zipFile.close();
            reject(error);
          });
          stream.on('end', () => {
            zipFile.close();
            resolve(Buffer.concat(chunks));
          });
        });
      });
      zipFile.on('end', () => reject(new Error(`Missing ${fileName} in ${zipPath}`)));
      zipFile.on('error', reject);
    });
  });
}

async function copyElectronRuntime(writer, electronZip, infoPlistBuffer, iconBuffer) {
  await new Promise((resolve, reject) => {
    yauzl.open(electronZip, { lazyEntries: true, validateEntrySizes: false }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      zipFile.readEntry();
      zipFile.on('entry', async (entry) => {
        try {
          if (!entry.fileName.startsWith('__MACOSX/')) {
            const transformedName = transformElectronEntryName(entry.fileName);
            const isInfoPlist = entry.fileName === 'Electron.app/Contents/Info.plist';
            const isIcon = entry.fileName === 'Electron.app/Contents/Resources/electron.icns';
            if (transformedName && !isInfoPlist && !isIcon) {
              writer.addRaw({
                name: transformedName,
                method: entry.compressionMethod,
                crc32: entry.crc32,
                compressedData: await readCompressedData(electronZip, entry),
                uncompressedSize: entry.uncompressedSize,
                externalFileAttributes: entry.externalFileAttributes,
                versionMadeBy: entry.versionMadeBy,
                versionNeeded: entry.versionNeededToExtract,
                modTime: entry.lastModFileTime,
                modDate: entry.lastModFileDate
              });
            }
          }
          zipFile.readEntry();
        } catch (error) {
          zipFile.close();
          reject(error);
        }
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });
  });

  writer.addBuffer(`${productName}.app/Contents/Info.plist`, infoPlistBuffer);
  writer.addBuffer(`${productName}.app/Contents/Resources/electron.icns`, iconBuffer);
}

async function addAppDirectory(writer, sourceDir, zipPrefix) {
  writer.addDirectory(zipPrefix);
  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const zipPath = `${zipPrefix}${entry.name}`;
    if (entry.isDirectory()) {
      await addAppDirectory(writer, sourcePath, `${zipPath}/`);
    } else if (entry.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      writer.addBuffer(zipPath, Buffer.from(target), {
        method: 0,
        mode: 0o120777
      });
    } else if (entry.isFile()) {
      writer.addBuffer(zipPath, await readFile(sourcePath), {
        mode: fileModeForAppPath(sourcePath)
      });
    }
  }
}

async function createIconIcns() {
  const source = path.join(root, 'logo.jpg');
  const sizes = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024]
  ];
  const chunks = [];
  for (const [type, size] of sizes) {
    const png = await sharp(source)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toBuffer();
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

async function createInfoPlist(electronZip, appPackage) {
  const original = plist.parse((await readZipEntryBuffer(electronZip, 'Electron.app/Contents/Info.plist')).toString('utf8'));
  original.CFBundleDisplayName = productName;
  original.CFBundleName = productName;
  original.CFBundleIdentifier = appId;
  original.CFBundleShortVersionString = appPackage.version || '1.0.0';
  original.CFBundleVersion = appPackage.version || '1.0.0';
  original.CFBundleIconFile = 'electron.icns';
  original.NSHighResolutionCapable = true;
  return Buffer.from(plist.build(original), 'utf8');
}

async function prepareAppSource(arch) {
  const stageDir = path.join(stagingRoot, `app-${arch}`);
  await rm(stageDir, { recursive: true, force: true });
  await cp(protectedRoot, stageDir, { recursive: true });
  await cp(path.join(root, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));

  run(npmCommand(), ['ci', '--omit=dev', '--include=optional', `--os=darwin`, `--cpu=${arch}`], {
    cwd: stageDir
  });

  await rm(path.join(stageDir, 'package-lock.json'), { force: true });
  await rm(path.join(stageDir, 'node_modules', '.package-lock.json'), { force: true });
  await rm(path.join(stageDir, 'node_modules', '.bin'), { recursive: true, force: true });

  const sharpPackage = path.join(stageDir, 'node_modules', '@img', requiredSharpPackage(arch));
  const libvipsPackage = path.join(stageDir, 'node_modules', '@img', requiredLibvipsPackage(arch));
  const winSharpPackage = path.join(stageDir, 'node_modules', '@img', 'sharp-win32-x64');
  if (!(await fileExists(sharpPackage)) || !(await fileExists(libvipsPackage))) {
    throw new Error(`Missing darwin sharp dependency for ${arch}`);
  }
  if (await fileExists(winSharpPackage)) {
    throw new Error(`Unexpected win32 sharp dependency in ${arch} app source`);
  }

  return stageDir;
}

async function createMacZip(arch, electronZip, appSourceDir, infoPlistBuffer, iconBuffer) {
  const outputPath = path.join(outputRoot, `${productName}-mac-${arch}.zip`);
  await rm(outputPath, { force: true });
  await mkdir(outputRoot, { recursive: true });
  const writer = new ZipWriter(outputPath);
  try {
    await copyElectronRuntime(writer, electronZip, infoPlistBuffer, iconBuffer);
    await addAppDirectory(writer, appSourceDir, `${productName}.app/Contents/Resources/app/`);
    writer.addBuffer(firstOpenFixScriptName, Buffer.from(firstOpenFixScript(), 'utf8'), {
      mode: 0o100755
    });
  } finally {
    writer.close();
  }
  return outputPath;
}

async function copyAppFromZip(writer, sourceZip, targetDir) {
  await new Promise((resolve, reject) => {
    yauzl.open(sourceZip, { lazyEntries: true, validateEntrySizes: false }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      zipFile.readEntry();
      zipFile.on('entry', async (entry) => {
        try {
          if (entry.fileName.startsWith(`${productName}.app/`)) {
            writer.addRaw({
              name: `${targetDir}/${entry.fileName}`,
              method: entry.compressionMethod,
              crc32: entry.crc32,
              compressedData: await readCompressedData(sourceZip, entry),
              uncompressedSize: entry.uncompressedSize,
              externalFileAttributes: entry.externalFileAttributes,
              versionMadeBy: entry.versionMadeBy,
              versionNeeded: entry.versionNeededToExtract,
              modTime: entry.lastModFileTime,
              modDate: entry.lastModFileDate
            });
          }
          zipFile.readEntry();
        } catch (error) {
          zipFile.close();
          reject(error);
        }
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });
  });
}

async function createUniversalMacZip(zipPathsByArch) {
  const outputPath = path.join(outputRoot, universalMacZipName);
  await rm(outputPath, { force: true });
  const writer = new ZipWriter(outputPath);
  try {
    await copyAppFromZip(writer, zipPathsByArch.arm64, universalArmDir);
    await copyAppFromZip(writer, zipPathsByArch.x64, universalX64Dir);
    writer.addBuffer(firstOpenFixScriptName, Buffer.from(universalFirstOpenFixScript(), 'utf8'), {
      mode: 0o100755
    });
  } finally {
    writer.close();
  }
  return outputPath;
}

async function listZipNames(zipPath) {
  return new Promise((resolve, reject) => {
    const names = [];
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        names.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolve(names));
      zipFile.on('error', reject);
    });
  });
}

async function listZipEntries(zipPath) {
  return new Promise((resolve, reject) => {
    const entries = [];
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        entries.push(entry);
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
    });
  });
}

function machCpuTypes(buffer) {
  const types = new Set();
  if (buffer.length < 8) return types;

  const magicLE = buffer.readUInt32LE(0);
  const magicBE = buffer.readUInt32BE(0);
  if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) {
    types.add(buffer.readInt32LE(4));
  } else if (magicBE === 0xfeedfacf || magicBE === 0xfeedface) {
    types.add(buffer.readInt32BE(4));
  } else if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) {
    const nfatArch = buffer.readUInt32BE(4);
    const stride = magicBE === 0xcafebabf ? 24 : 20;
    for (let i = 0; i < nfatArch; i += 1) {
      const offset = 8 + i * stride;
      if (offset + 4 <= buffer.length) {
        types.add(buffer.readInt32BE(offset));
      }
    }
  }
  return types;
}

async function verifyExecutableArch(zipPath, executablePath, arch) {
  const executable = await readZipEntryBuffer(zipPath, executablePath);
  const expectedCpuType = arch === 'arm64' ? 0x0100000c : 0x01000007;
  const cpuTypes = machCpuTypes(executable);
  if (!cpuTypes.has(expectedCpuType)) {
    throw new Error(`${path.basename(zipPath)} ${executablePath} is not ${arch}`);
  }
}

async function verifyMacZip(zipPath, arch) {
  const names = await listZipNames(zipPath);
  const nameSet = new Set(names);
  const prefix = `${productName}.app/Contents`;
  const required = [
    `${prefix}/Info.plist`,
    `${prefix}/MacOS/Electron`,
    `${prefix}/Resources/electron.icns`,
    `${prefix}/Resources/app/package.json`,
    `${prefix}/Resources/app/dist/index.html`,
    `${prefix}/Resources/app/src/main/main.cjs`,
    `${prefix}/Resources/app/src/main/preload.cjs`,
    `${prefix}/Resources/app/src/main/runninghub.cjs`,
    `${prefix}/Resources/app/node_modules/sharp/package.json`,
    `${prefix}/Resources/app/node_modules/@img/${requiredSharpPackage(arch)}/package.json`,
    `${prefix}/Resources/app/node_modules/@img/${requiredLibvipsPackage(arch)}/package.json`,
    firstOpenFixScriptName
  ];

  const missing = required.filter((name) => !nameSet.has(name));
  if (missing.length > 0) {
    throw new Error(`Mac ${arch} zip is missing:\n${missing.join('\n')}`);
  }
  if (names.some((name) => name.includes('/node_modules/@img/sharp-win32-'))) {
    throw new Error(`Mac ${arch} zip contains win32 sharp binaries`);
  }

  const info = plist.parse((await readZipEntryBuffer(zipPath, `${prefix}/Info.plist`)).toString('utf8'));
  if (info.CFBundleName !== productName || info.CFBundleIdentifier !== appId) {
    throw new Error(`Mac ${arch} Info.plist metadata mismatch`);
  }

  await verifyExecutableArch(zipPath, `${prefix}/MacOS/Electron`, arch);

  const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`verified ${path.basename(zipPath)} (${sizeMb} MB)`);
}

async function verifyUniversalMacZip(zipPath) {
  const entries = await listZipEntries(zipPath);
  const names = entries.map((entry) => entry.fileName);
  const nameSet = new Set(names);
  const required = [
    firstOpenFixScriptName,
    `${universalArmDir}/${productName}.app/Contents/Info.plist`,
    `${universalArmDir}/${productName}.app/Contents/MacOS/Electron`,
    `${universalArmDir}/${productName}.app/Contents/Resources/app/dist/index.html`,
    `${universalArmDir}/${productName}.app/Contents/Resources/app/node_modules/@img/${requiredSharpPackage('arm64')}/package.json`,
    `${universalArmDir}/${productName}.app/Contents/Resources/app/node_modules/@img/${requiredLibvipsPackage('arm64')}/package.json`,
    `${universalX64Dir}/${productName}.app/Contents/Info.plist`,
    `${universalX64Dir}/${productName}.app/Contents/MacOS/Electron`,
    `${universalX64Dir}/${productName}.app/Contents/Resources/app/dist/index.html`,
    `${universalX64Dir}/${productName}.app/Contents/Resources/app/node_modules/@img/${requiredSharpPackage('x64')}/package.json`,
    `${universalX64Dir}/${productName}.app/Contents/Resources/app/node_modules/@img/${requiredLibvipsPackage('x64')}/package.json`
  ];

  const missing = required.filter((name) => !nameSet.has(name));
  if (missing.length > 0) {
    throw new Error(`Universal Mac zip is missing:\n${missing.join('\n')}`);
  }
  if (names.some((name) => name.includes('/node_modules/@img/sharp-win32-'))) {
    throw new Error('Universal Mac zip contains win32 sharp binaries');
  }

  const fixEntry = entries.find((entry) => entry.fileName === firstOpenFixScriptName);
  const fixMode = (fixEntry.externalFileAttributes >>> 16) & 0xffff;
  if (fixMode !== 0o100755) {
    throw new Error(`${firstOpenFixScriptName} is not executable in universal zip`);
  }

  const fixScript = (await readZipEntryBuffer(zipPath, firstOpenFixScriptName)).toString('utf8');
  for (const requiredText of ['/usr/bin/uname -m', '/usr/bin/xattr -cr', '/usr/bin/open', universalArmDir, universalX64Dir]) {
    if (!fixScript.includes(requiredText)) {
      throw new Error(`${firstOpenFixScriptName} is missing ${requiredText}`);
    }
  }

  await verifyExecutableArch(zipPath, `${universalArmDir}/${productName}.app/Contents/MacOS/Electron`, 'arm64');
  await verifyExecutableArch(zipPath, `${universalX64Dir}/${productName}.app/Contents/MacOS/Electron`, 'x64');

  const armInfo = plist.parse((await readZipEntryBuffer(zipPath, `${universalArmDir}/${productName}.app/Contents/Info.plist`)).toString('utf8'));
  const x64Info = plist.parse((await readZipEntryBuffer(zipPath, `${universalX64Dir}/${productName}.app/Contents/Info.plist`)).toString('utf8'));
  if (armInfo.CFBundleName !== productName || x64Info.CFBundleName !== productName) {
    throw new Error('Universal Mac zip Info.plist metadata mismatch');
  }

  const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`verified ${path.basename(zipPath)} (${sizeMb} MB)`);
}

async function main() {
  if (!process.env.ELECTRON_MIRROR && !process.env.npm_config_electron_mirror) {
    process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  }

  const electronVersion = JSON.parse(await readFile(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const appPackage = JSON.parse(await readFile(path.join(protectedRoot, 'package.json'), 'utf8'));
  const iconBuffer = await createIconIcns();

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  const zipPathsByArch = {};
  for (const arch of archs) {
    console.log(`packaging mac ${arch} with Electron ${electronVersion}`);
    const electronZip = await downloadArtifact({
      version: electronVersion,
      platform: 'darwin',
      arch,
      artifactName: 'electron'
    });
    const infoPlistBuffer = await createInfoPlist(electronZip, appPackage);
    const appSourceDir = await prepareAppSource(arch);
    const outputPath = await createMacZip(arch, electronZip, appSourceDir, infoPlistBuffer, iconBuffer);
    await verifyMacZip(outputPath, arch);
    zipPathsByArch[arch] = outputPath;
  }

  const universalOutputPath = await createUniversalMacZip(zipPathsByArch);
  await verifyUniversalMacZip(universalOutputPath);
  await Promise.all(archs.map((arch) => rm(zipPathsByArch[arch], { force: true })));

  await rm(stagingRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
