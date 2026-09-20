// sp4sap:program-to-spec — Image swap helper for cloned spec xlsx files.
//
// SLOTS (Sheet, anchor, drawing file)
//   selection   → xl/media/image2.png  (Sheet 3, C4,  drawing3.xml block 1)
//   alv         → xl/media/image1.png  (Sheet 3, C19, drawing3.xml block 2)
//   processFlow → xl/media/image3.png  (Sheet 4, B19, drawing4.xml — created on
//                 demand; the template ships a blank drawing4 because every
//                 program has a different flow chart)
//
//   Each slot's `<xdr:ext>` is always computed from the supplied PNG's IHDR
//   (px × 9525 EMU). Reusing the template's fixed extent would stretch any
//   PNG whose aspect ratio differs — selection at 3.21:1 slot vs 3.88:1 PNG
//   produced visibly squished text (fixed 2026-05-24).
//
// API
//   swapImages({ xlsxPath, selectionPng?, alvPng?, processFlowPng? })
//     Each PNG input is Buffer | string (file path) | null.
//     Returns { xlsxPath, swapped: { selection, alv, processFlow }, bytes }.
//
// CLI
//   node image-swap.mjs <xlsx> --selection <p> --alv <p> --process-flow <p>
//   node image-swap.mjs <xlsx> <selection.png> <alv.png> <process-flow.png>
//       (positional, use "-" to skip any slot)
//
// SAFETY
//   · PNG signature verified before any write; non-PNG input rejected.
//   · template_base.xlsx is never touched.
//   · Image swap is opt-in (trigger keywords only) so the default
//     program-to-spec path stays drift-free.
//   · drawing3.xml: only the cx/cy of the matched oneCellAnchor block is
//     touched. drawing4.xml is mutated ONLY when processFlowPng is supplied.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { unzipEntries, zipFiles } from './xlsx-zip.mjs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EMU_PER_PX = 9525; // 96 DPI → 1 inch = 914400 EMU → 1 px = 9525 EMU

// Process Flow anchor on Sheet 4 (B19 = col 1, row 18 in 0-indexed XML coords).
// B18 is the "Process Flow Chart" heading text → image starts one row below.
const PF_FROM_COL = 1, PF_FROM_ROW = 18;

function loadPng(input, label) {
  if (input == null) return null;
  let buf;
  if (Buffer.isBuffer(input)) buf = input;
  else if (typeof input === 'string') {
    if (!existsSync(input)) throw new Error(`image-swap: ${label} PNG not found at ${input}`);
    buf = readFileSync(input);
  } else {
    throw new Error(`image-swap: ${label} must be Buffer or file path, got ${typeof input}`);
  }
  if (buf.length < 24 || !PNG_SIG.equals(buf.slice(0, 8))) {
    throw new Error(`image-swap: ${label} does not have a valid PNG signature`);
  }
  // Read width/height from the IHDR chunk (always the first chunk after sig).
  // chunk layout: [4 len][4 type "IHDR"][4 width BE][4 height BE]...
  const width  = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { buf, width, height };
}

function buildDrawing4Xml({ cx, cy }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>${PF_FROM_COL}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${PF_FROM_ROW}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="image3.png"/><xdr:cNvPicPr preferRelativeResize="0"/></xdr:nvPicPr><xdr:blipFill><a:blip cstate="print" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></xdr:spPr></xdr:pic><xdr:clientData fLocksWithSheet="0"/></xdr:oneCellAnchor></xdr:wsDr>`;
}

const DRAWING4_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.png"/></Relationships>`;

// Surgically replace the <xdr:ext .../> inside the <xdr:oneCellAnchor> block
// whose <xdr:pic> references the given image filename. Anchor position
// (xdr:from col/row/offsets) is untouched. Robust against block reordering
// because the block is identified by the image name in <xdr:cNvPr name=...>.
function updateAnchorExt(xml, imageName, cx, cy) {
  const blockRe = /<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g;
  let touched = false;
  const out = xml.replace(blockRe, (block) => {
    if (!block.includes(`name="${imageName}"`)) return block;
    touched = true;
    return block.replace(/<xdr:ext\s+cx="\d+"\s+cy="\d+"\s*\/>/,
      `<xdr:ext cx="${cx}" cy="${cy}"/>`);
  });
  if (!touched) {
    throw new Error(`image-swap: drawing3.xml has no oneCellAnchor referencing ${imageName}`);
  }
  return out;
}

function injectProcessFlow(entries, pfBuf, pfW, pfH) {
  const cx = pfW * EMU_PER_PX;
  const cy = pfH * EMU_PER_PX;
  const newDrawing = Buffer.from(buildDrawing4Xml({ cx, cy }), 'utf8');
  const newRels = Buffer.from(DRAWING4_RELS, 'utf8');
  const mediaEntry = { name: 'xl/media/image3.png', data: pfBuf };
  const relsEntry  = { name: 'xl/drawings/_rels/drawing4.xml.rels', data: newRels };
  let replacedDrawing = false, replacedMedia = false, replacedRels = false;
  for (const e of entries) {
    if (e.name === 'xl/drawings/drawing4.xml') { e.data = newDrawing; replacedDrawing = true; }
    else if (e.name === 'xl/media/image3.png') { e.data = pfBuf; replacedMedia = true; }
    else if (e.name === 'xl/drawings/_rels/drawing4.xml.rels') { e.data = newRels; replacedRels = true; }
  }
  if (!replacedDrawing) throw new Error('image-swap: xl/drawings/drawing4.xml missing — wrong template?');
  if (!replacedMedia) entries.push(mediaEntry);
  if (!replacedRels)  entries.push(relsEntry);
}

export function swapImages({ xlsxPath, selectionPng = null, alvPng = null, processFlowPng = null, verbose = true }) {
  if (!xlsxPath) throw new Error('image-swap: xlsxPath is required');
  if (!existsSync(xlsxPath)) throw new Error(`image-swap: xlsx not found at ${xlsxPath}`);
  const sel = loadPng(selectionPng, 'selectionPng');
  const alv = loadPng(alvPng, 'alvPng');
  const pf  = loadPng(processFlowPng, 'processFlowPng');
  if (!sel && !alv && !pf) {
    if (verbose) console.log('image-swap: nothing to swap (all inputs null) — file untouched');
    return { xlsxPath, swapped: { selection: false, alv: false, processFlow: false }, bytes: 0 };
  }

  const entries = unzipEntries(readFileSync(xlsxPath));
  let sawSel = false, sawAlv = false, sawDrawing3 = false;
  for (const e of entries) {
    if (sel && e.name === 'xl/media/image2.png') { e.data = sel.buf; sawSel = true; }
    else if (alv && e.name === 'xl/media/image1.png') { e.data = alv.buf; sawAlv = true; }
  }
  if (sel && !sawSel) throw new Error('image-swap: xl/media/image2.png slot not found — wrong template?');
  if (alv && !sawAlv) throw new Error('image-swap: xl/media/image1.png slot not found — wrong template?');
  // Update drawing3.xml extents so each PNG renders at its native aspect ratio.
  if (sel || alv) {
    for (const e of entries) {
      if (e.name !== 'xl/drawings/drawing3.xml') continue;
      let xml = e.data.toString('utf8');
      if (sel) xml = updateAnchorExt(xml, 'image2.png', sel.width * EMU_PER_PX, sel.height * EMU_PER_PX);
      if (alv) xml = updateAnchorExt(xml, 'image1.png', alv.width * EMU_PER_PX, alv.height * EMU_PER_PX);
      e.data = Buffer.from(xml, 'utf8');
      sawDrawing3 = true;
    }
    if (!sawDrawing3) throw new Error('image-swap: xl/drawings/drawing3.xml not found — wrong template?');
  }
  if (pf) injectProcessFlow(entries, pf.buf, pf.width, pf.height);

  const out = zipFiles(entries);
  writeFileSync(xlsxPath, out);
  if (verbose) {
    const tag = [];
    if (sawSel) tag.push(`selection→image2.png (${sel.buf.length} B)`);
    if (sawAlv) tag.push(`alv→image1.png (${alv.buf.length} B)`);
    if (pf)     tag.push(`processFlow→image3.png (${pf.buf.length} B, ${pf.width}×${pf.height} px)`);
    console.log(`image-swap: ${xlsxPath} updated — ${tag.join(', ')} | total ${out.length} B`);
  }
  return { xlsxPath, swapped: { selection: sawSel, alv: sawAlv, processFlow: !!pf }, bytes: out.length };
}

// ──────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────
function parseCliArgs(argv) {
  const args = { xlsx: null, selection: null, alv: null, processFlow: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selection' || a === '-s')     { args.selection = argv[++i]; continue; }
    if (a === '--alv' || a === '-a')           { args.alv = argv[++i]; continue; }
    if (a === '--process-flow' || a === '-p')  { args.processFlow = argv[++i]; continue; }
    if (a === '--help' || a === '-h')          { args.help = true; continue; }
    positional.push(a);
  }
  if (positional[0] && !args.xlsx) args.xlsx = positional[0];
  if (positional[1] && args.selection  == null && positional[1] !== '-') args.selection  = positional[1];
  if (positional[2] && args.alv        == null && positional[2] !== '-') args.alv        = positional[2];
  if (positional[3] && args.processFlow== null && positional[3] !== '-') args.processFlow= positional[3];
  return args;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || !args.xlsx) {
    console.log('Usage:');
    console.log('  node image-swap.mjs <xlsx> --selection <p> --alv <p> --process-flow <p>');
    console.log('  node image-swap.mjs <xlsx> <selection.png> <alv.png> <process-flow.png>');
    console.log('      (positional, use "-" to skip any slot)');
    process.exit(args.help ? 0 : 2);
  }
  try {
    swapImages({
      xlsxPath: resolve(args.xlsx),
      selectionPng:   args.selection   ? resolve(args.selection)   : null,
      alvPng:         args.alv         ? resolve(args.alv)         : null,
      processFlowPng: args.processFlow ? resolve(args.processFlow) : null,
    });
  } catch (e) {
    console.error(`image-swap: ${e.message}`);
    process.exit(1);
  }
}
