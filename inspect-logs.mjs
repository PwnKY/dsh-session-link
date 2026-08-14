// Inspect session logs (concatenated zstd frames) for session-reference evidence.
import { readFileSync, readdirSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { join } from "node:path";

const ZSTD_MAGIC = 0xfd2fb528;

/** Scan frame boundaries in a concatenated-zstd buffer (mirrors dsh-session-persistence-jsonl). */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad frame magic at ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error("reserved frame-header bit");
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error("reserved block type");
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

function decodeAll(buffer) {
  const { frames } = scanZstdFrames(buffer);
  const parts = [];
  for (const frame of frames) {
    const plain = zstdDecompressSync(buffer.subarray(frame.start, frame.end));
    parts.push(plain.toString("utf8"));
  }
  return parts.join("");
}

const base = process.argv[2];
const targets = process.argv.slice(3);
for (const dir of readdirSync(base)) {
  if (targets.length > 0 && !targets.includes(dir)) continue;
  const full = join(base, dir);
  const files = readdirSync(full).filter((f) => f.includes("jsonl"));
  if (files.length === 0) continue;
  const file = join(full, files[0]);
  const out = decodeAll(readFileSync(file));
  const lines = out.split("\n").filter(Boolean);
  const types = {};
  for (const l of lines) {
    const e = JSON.parse(l);
    types[e.type] = (types[e.type] ?? 0) + 1;
  }
  const refs = lines.filter((l) => l.includes("session-reference"));
  const linkRefs = lines.filter((l) => l.includes("069cb62a") && !l.includes('"id":"session-069cb62a'));
  console.log(`=== ${dir} ===`);
  console.log(`  lines=${lines.length} types=${JSON.stringify(types)}`);
  console.log(`  session-reference events: ${refs.length}, mentions of source id: ${linkRefs.length}`);
  if (refs.length > 0) {
    for (const l of refs.slice(0, 2)) {
      const e = JSON.parse(l);
      console.log(`  REF type=${e.type} seq=${e.seq} data=${JSON.stringify(e.data).slice(0, 600)}`);
    }
  }
}
