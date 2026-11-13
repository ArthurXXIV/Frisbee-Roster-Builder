// Minimal .xlsx reader/writer with no dependencies. Works in browsers and Node 18+.
// Reads the first worksheet as rows of strings; writes one sheet of text cells.
// Uses the platform's DecompressionStream for deflated zip entries.

const td = new TextDecoder(), te = new TextEncoder();

// ---------- zip ----------
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not an .xlsx file (no zip directory found)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt .xlsx file');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + size);
    files[name] = { method, data };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async name => {
    const f = files[name];
    if (!f) return null;
    if (f.method === 0) return td.decode(f.data);
    if (f.method === 8) return td.decode(await inflateRaw(f.data));
    throw new Error(`Unsupported compression in ${name}`);
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zipStore(entries) { // [{ name, text }] → Uint8Array (no compression)
  const parts = [], central = [];
  let offset = 0;
  for (const { name, text } of entries) {
    const nb = te.encode(name), data = te.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

// ---------- xml helpers ----------
const unesc = s => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
  ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()] ??
   String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const escXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const textOf = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('');
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const colName = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Reads the first worksheet of an .xlsx file → string[][] (rows of cell text; empty cells are ''). */
export async function readXlsx(buf) {
  const get = await unzip(buf);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
  const rid = wb && (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${rid}"`));
    const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheet = await get(sheetPath);
  if (!sheet) throw new Error('The .xlsx file has no worksheet');
  const ssXml = await get('xl/sharedStrings.xml');
  const shared = ssXml ? [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rNum = +((rm[1].match(/\br="(\d+)"/) || [])[1] || rows.length + 1);
    const row = [];
    let next = 0;
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const ci = ref ? colIndex(ref) : next;
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) val = unesc(v);
      while (row.length < ci) row.push('');
      row[ci] = val; next = ci + 1;
    }
    while (rows.length < rNum - 1) rows.push([]);
    rows[rNum - 1] = row;
  }
  return rows;
}

/** Writes rows (array of arrays) into a one-sheet .xlsx → Uint8Array. Every cell is text; the first row is bold. */
export function writeXlsx(rows, sheetName = 'Roster') {
  const width = Math.max(1, ...rows.map(r => r.length));
  const cols = Array.from({ length: width }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(8, ...rows.map(r => String(r[i] ?? '').length + 2)))}" customWidth="1"/>`).join('');
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v === '' || v == null ? '' :
    `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escXml(v)}</t></is></c>`).join('')}</row>`).join('');
  const name = escXml(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zipStore([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
}
