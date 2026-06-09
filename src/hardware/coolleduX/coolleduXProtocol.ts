import { PixelMatrix, assertMatrix16x96 } from "../../matrix/core16x96.js";

const START_BYTE = 0x01;
const ESCAPE_BYTE = 0x02;
const END_BYTE = 0x03;
const XOR_MASK = 0x04;
const PROGRAM_START = 0x02;
const PROGRAM_DATA = 0x03;
const DEFAULT_PROGRAM_CHUNK_SIZE = 1024;

export type CoolLedUxUpload = {
  rawProgramLength: number;
  compressedLength: number;
  compressed: boolean;
  packets: Buffer[];
};

export function buildMatrixProgramUpload(matrix: PixelMatrix, intensity = 1): CoolLedUxUpload {
  return buildMatrixFramesProgramUpload([matrix], intensity);
}

export function buildMatrixFramesProgramUpload(matrices: PixelMatrix[], intensity = 1): CoolLedUxUpload {
  if (matrices.length === 0) throw new Error("At least one matrix frame is required.");
  for (const matrix of matrices) assertMatrix16x96(matrix);

  const contents = matrices.map((matrix, index) => buildGraffitiContent(96, 16, matrixToRgb444(matrix, intensity), index === matrices.length - 1));
  const program = wrapProgramPayload(...contents);
  const { data: compressedData, compressed } = lzssCompress(program);
  const packets = [buildProgramStartPacket(program, 0, 1, 1), ...buildProgramDataChunks(compressedData, DEFAULT_PROGRAM_CHUNK_SIZE)];

  return {
    rawProgramLength: program.length,
    compressedLength: compressedData.length,
    compressed,
    packets
  };
}

export function splitBleWrites(packet: Buffer, writeSize = 20): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < packet.length; offset += writeSize) {
    chunks.push(packet.subarray(offset, Math.min(packet.length, offset + writeSize)));
  }
  return chunks;
}

export function parseStreamFramesFromBuffer(buffer: Buffer): { frames: Buffer[]; remaining: Buffer } {
  const frames: Buffer[] = [];
  let searchOffset = 0;

  while (searchOffset < buffer.length) {
    const start = buffer.indexOf(START_BYTE, searchOffset);
    if (start < 0) return { frames, remaining: Buffer.alloc(0) };
    const end = buffer.indexOf(END_BYTE, start + 1);
    if (end < 0) return { frames, remaining: buffer.subarray(start) };

    try {
      frames.push(parseStreamFrame(buffer.subarray(start, end + 1)));
    } catch {
      // Skip malformed frames and continue looking for a valid start byte.
    }
    searchOffset = end + 1;
  }

  return { frames, remaining: Buffer.alloc(0) };
}

function matrixToRgb444(matrix: PixelMatrix, intensity: number): Buffer {
  const bytes = Buffer.alloc(96 * 16 * 2);
  let offset = 0;

  for (let col = 0; col < 96; col += 1) {
    for (let row = 0; row < 16; row += 1) {
      const [first, second] = colorToRgb444(matrix[row]?.[col] ?? "off", intensity);
      bytes[offset] = first;
      bytes[offset + 1] = second;
      offset += 2;
    }
  }

  return bytes;
}

function colorToRgb444(color: string, intensity: number): [number, number] {
  const level = Math.max(0.1, Math.min(1, intensity));
  if (color === "green") return scaleRgb444(0x00, 0xf0, level);
  if (color === "blue") return scaleRgb444(0x00, 0x0f, level);
  if (color === "orange") return scaleRgb444(0x0f, 0x90, level);
  if (color === "red") return scaleRgb444(0x0f, 0x00, level);
  if (color === "yellow") return scaleRgb444(0x0f, 0xf0, level);
  if (color === "purple") return scaleRgb444(0x0f, 0x0f, level);
  if (color === "gray") return scaleRgb444(0x07, 0x77, level);
  if (color === "white") return scaleRgb444(0x0f, 0xff, level);
  return [0x00, 0x00];
}

function scaleRgb444(first: number, second: number, intensity: number): [number, number] {
  const red = scaleNibble(first & 0x0f, intensity);
  const green = scaleNibble((second & 0xf0) >> 4, intensity);
  const blue = scaleNibble(second & 0x0f, intensity);
  return [red, (green << 4) | blue];
}

function scaleNibble(value: number, intensity: number): number {
  if (value === 0) return 0;
  return Math.max(1, Math.min(15, Math.round(value * intensity)));
}

function buildGraffitiContent(width: number, height: number, imageData: Buffer, stay = false): Buffer {
  const totalLength = 28 + imageData.length;
  const buffer = Buffer.alloc(totalLength);
  buffer.writeUInt32BE(totalLength, 0);
  buffer[4] = 0x02;
  buffer[12] = 0x01;
  buffer.writeUInt16BE(width, 17);
  buffer.writeUInt16BE(height, 19);
  buffer[21] = 0x01; // static
  buffer[22] = 0x01; // speed
  buffer[23] = stay ? 0x00 : 0x01;
  buffer.writeUInt32BE(imageData.length, 24);
  imageData.copy(buffer, 28);
  return buffer;
}

function wrapProgramPayload(...contents: Buffer[]): Buffer {
  const dataLength = contents.reduce((sum, content) => sum + content.length, 0);
  const buffer = Buffer.alloc(10 + dataLength);
  buffer[8] = contents.length;
  let offset = 10;
  for (const content of contents) {
    content.copy(buffer, offset);
    offset += content.length;
  }
  return buffer;
}

function buildProgramStartPacket(programData: Buffer, index: number, count: number, showCount: number): Buffer {
  const inner = Buffer.alloc(12);
  inner[0] = PROGRAM_START;
  inner.writeUInt32BE(coolLedUxCrc32(programData), 1);
  inner.writeUInt32BE(programData.length, 5);
  inner[9] = index;
  inner[10] = count;
  inner[11] = showCount;
  return buildStreamFrame(inner);
}

function buildProgramDataChunks(compressedData: Buffer, chunkSize: number): Buffer[] {
  const packets: Buffer[] = [];
  for (let chunkIndex = 0, offset = 0; offset < compressedData.length; chunkIndex += 1, offset += chunkSize) {
    const chunk = compressedData.subarray(offset, Math.min(compressedData.length, offset + chunkSize));
    const inner = Buffer.alloc(11 + chunk.length);
    inner[0] = PROGRAM_DATA;
    inner[1] = 0x00;
    inner.writeUInt32BE(compressedData.length, 2);
    inner.writeUInt16BE(chunkIndex, 6);
    inner.writeUInt16BE(chunk.length, 8);
    chunk.copy(inner, 10);

    let xor = 0;
    for (const byte of inner.subarray(1, 10 + chunk.length)) xor ^= byte;
    inner[10 + chunk.length] = xor;

    packets.push(buildStreamFrame(inner));
  }
  return packets;
}

function buildStreamFrame(data: Buffer): Buffer {
  const lenBytes = Buffer.alloc(2);
  lenBytes.writeUInt16BE(data.length, 0);
  const escaped = escapeStreamBytes(Buffer.concat([lenBytes, data]));
  return Buffer.concat([Buffer.from([START_BYTE]), escaped, Buffer.from([END_BYTE])]);
}

function parseStreamFrame(frame: Buffer): Buffer {
  if (frame[0] !== START_BYTE || frame[frame.length - 1] !== END_BYTE) throw new Error("Invalid stream frame");
  const unescaped = unescapeStreamBytes(frame.subarray(1, frame.length - 1));
  if (unescaped.length < 2) throw new Error("Invalid stream frame length");
  const length = unescaped.readUInt16BE(0);
  return unescaped.subarray(2, 2 + length);
}

function escapeStreamBytes(data: Buffer): Buffer {
  const escaped: number[] = [];
  for (const byte of data) {
    if (byte >= START_BYTE && byte <= END_BYTE) escaped.push(ESCAPE_BYTE, byte ^ XOR_MASK);
    else escaped.push(byte);
  }
  return Buffer.from(escaped);
}

function unescapeStreamBytes(data: Buffer): Buffer {
  const unescaped: number[] = [];
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];
    if (byte === ESCAPE_BYTE) {
      index += 1;
      if (index >= data.length) throw new Error("Truncated escape sequence");
      unescaped.push(data[index] ^ XOR_MASK);
    } else {
      unescaped.push(byte);
    }
  }
  return Buffer.from(unescaped);
}

function coolLedUxCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    let xbit = 0x80000000;
    const value = byte & 0xff;
    for (let index = 0; index < 32; index += 1) {
      crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
      if (value & xbit) crc = (crc ^ 0x04c11db7) >>> 0;
      xbit >>>= 1;
    }
  }
  return crc >>> 0;
}

function lzssCompress(data: Buffer): { data: Buffer; compressed: boolean } {
  if (data.length === 0) return { data, compressed: false };

  const windowSize = 512;
  const lookaheadSize = 18;
  const matchThreshold = 2;
  const window = Buffer.alloc(windowSize);
  let writePointer = windowSize - lookaheadSize;
  let historyLength = 0;
  const result: number[] = [];
  let codeBuffer = new Array<number>(17).fill(0);
  let codeBufferPointer = 1;
  let flags = 0;
  let flagMask = 1;

  let position = 0;
  while (position < data.length) {
    const maxMatch = Math.min(lookaheadSize, data.length - position);
    let matchLength = 0;
    let matchPosition = 0;

    if (historyLength > 0) {
      const maxSearch = Math.min(historyLength, windowSize);
      for (let distance = 1; distance <= maxSearch; distance += 1) {
        const candidateIndex = (writePointer - distance) & (windowSize - 1);
        const extensionMax = Math.min(maxMatch, distance);
        let length = 0;
        while (length < extensionMax && window[(candidateIndex + length) & (windowSize - 1)] === data[position + length]) {
          length += 1;
        }
        if (length > matchLength) {
          matchLength = length;
          matchPosition = candidateIndex;
          if (matchLength === maxMatch) break;
        }
      }
    }

    if (matchLength > matchThreshold) {
      codeBuffer[codeBufferPointer] = matchPosition & 0xff;
      codeBuffer[codeBufferPointer + 1] = ((matchPosition >> 4) & 0xf0) | ((matchLength - 3) & 0x0f);
      codeBufferPointer += 2;
    } else {
      matchLength = 1;
      flags |= flagMask;
      codeBuffer[codeBufferPointer] = data[position];
      codeBufferPointer += 1;
    }

    flagMask <<= 1;
    if (flagMask === 0x100) {
      codeBuffer[0] = flags;
      result.push(...codeBuffer.slice(0, codeBufferPointer));
      codeBuffer = new Array<number>(17).fill(0);
      codeBufferPointer = 1;
      flags = 0;
      flagMask = 1;
    }

    for (let index = 0; index < matchLength; index += 1) {
      window[writePointer] = data[position + index];
      writePointer = (writePointer + 1) & (windowSize - 1);
    }
    historyLength = Math.min(windowSize, historyLength + matchLength);
    position += matchLength;
  }

  if (codeBufferPointer > 1) {
    codeBuffer[0] = flags;
    result.push(...codeBuffer.slice(0, codeBufferPointer));
  }

  const compressed = Buffer.from(result);
  return compressed.length < data.length ? { data: compressed, compressed: true } : { data, compressed: false };
}
