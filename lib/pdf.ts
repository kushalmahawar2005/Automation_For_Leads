// Minimal, dependency-free PDF writer for tabular lead exports.
// Uses the two standard PDF fonts (Helvetica / Helvetica-Bold) so nothing has
// to be embedded — keeps this working inside the Next.js server bundle.

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const TITLE_SIZE = 16;
const SUB_SIZE = 9;
const HEAD_SIZE = 9.5;
const CELL_SIZE = 9;
const ROW_H = 18;

// Helvetica advance widths (per 1000 units) for chars 32..126.
const HELV_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Characters we can map into WinAnsi instead of dropping.
const TRANSLIT: Record<string, string> = {
  "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ", "•": "-",
  "₹": "Rs.", "™": "(TM)", "®": "(R)",
};

/** Reduce arbitrary text to bytes the standard WinAnsi encoding can show. */
function sanitize(input: string): string {
  let out = "";
  for (const ch of String(input ?? "")) {
    if (TRANSLIT[ch] !== undefined) {
      out += TRANSLIT[ch];
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else if (code === 9) out += " ";
    // Anything else (Devanagari, emoji, …) can't render in a standard font.
  }
  return out.replace(/\s+/g, " ").trim();
}

function charWidth(code: number, size: number): number {
  const w = code >= 32 && code <= 126 ? HELV_W[code - 32] : 556;
  return (w / 1000) * size;
}

function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += charWidth(text.charCodeAt(i), size);
  return bold ? w * 1.06 : w; // Helvetica-Bold runs slightly wider
}

/** Trim text with an ellipsis so it fits inside `maxW` points. */
function fit(text: string, maxW: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxW) return text;
  const dots = textWidth("...", size, bold);
  let w = 0;
  let out = "";
  for (const ch of text) {
    const cw = charWidth(ch.charCodeAt(0), size) * (bold ? 1.06 : 1);
    if (w + cw + dots > maxW) break;
    out += ch;
    w += cw;
  }
  return out.trimEnd() + "...";
}

function esc(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

const n = (v: number) => v.toFixed(2);

function drawText(x: number, y: number, size: number, font: "F1" | "F2", text: string): string {
  return `BT /${font} ${n(size)} Tf ${n(x)} ${n(y)} Td (${esc(text)}) Tj ET\n`;
}

export type PdfColumn = {
  header: string;
  /** Share of the available content width (all weights are normalised). */
  weight: number;
  align?: "left" | "right";
};

export type PdfTableInput = {
  title: string;
  subtitle?: string;
  columns: PdfColumn[];
  rows: string[][];
  footerNote?: string;
};

/**
 * Render a paginated table to a PDF file buffer.
 */
export function buildTablePdf({ title, subtitle, columns, rows, footerNote }: PdfTableInput): Buffer {
  const totalWeight = columns.reduce((s, c) => s + c.weight, 0) || 1;
  const colW = columns.map((c) => (c.weight / totalWeight) * CONTENT_W);
  const colX: number[] = [];
  let acc = MARGIN;
  for (const w of colW) {
    colX.push(acc);
    acc += w;
  }

  const firstPageTop = PAGE_H - MARGIN - 46; // room for title + subtitle
  const laterPageTop = PAGE_H - MARGIN - 12;
  const bottom = MARGIN + 24; // room for the footer line

  const rowsPerPage = (top: number) => Math.max(1, Math.floor((top - ROW_H - bottom) / ROW_H));

  // Split rows across pages up front so the footer can show "Page x of y".
  const pages: string[][][] = [];
  let idx = 0;
  while (idx < rows.length) {
    const cap = rowsPerPage(pages.length === 0 ? firstPageTop : laterPageTop);
    pages.push(rows.slice(idx, idx + cap));
    idx += cap;
  }
  if (pages.length === 0) pages.push([]);

  const streams = pages.map((pageRows, pageIndex) => {
    let s = "";
    let y = PAGE_H - MARGIN;

    if (pageIndex === 0) {
      s += drawText(MARGIN, y - TITLE_SIZE, TITLE_SIZE, "F2", sanitize(title));
      y -= TITLE_SIZE + 8;
      if (subtitle) {
        s += "0.42 0.45 0.5 rg\n";
        s += drawText(MARGIN, y - SUB_SIZE, SUB_SIZE, "F1", sanitize(subtitle));
        s += "0 g\n";
        y -= SUB_SIZE + 12;
      } else {
        y -= 12;
      }
    } else {
      y -= 12;
    }

    // Header row
    const headBaseline = y - HEAD_SIZE - 2;
    s += `0.93 0.94 0.96 rg ${n(MARGIN)} ${n(y - ROW_H + 4)} ${n(CONTENT_W)} ${n(ROW_H)} re f\n0 g\n`;
    columns.forEach((c, i) => {
      const label = fit(sanitize(c.header), colW[i] - 8, HEAD_SIZE, true);
      const x = c.align === "right" ? colX[i] + colW[i] - 6 - textWidth(label, HEAD_SIZE, true) : colX[i] + 6;
      s += drawText(x, headBaseline, HEAD_SIZE, "F2", label);
    });
    y -= ROW_H;

    // Body rows
    for (const row of pageRows) {
      const baseline = y - CELL_SIZE - 3;
      s += `0.86 0.88 0.91 RG 0.5 w ${n(MARGIN)} ${n(y - ROW_H + 3)} m ${n(MARGIN + CONTENT_W)} ${n(y - ROW_H + 3)} l S\n`;
      columns.forEach((c, i) => {
        const cell = fit(sanitize(row[i] ?? ""), colW[i] - 10, CELL_SIZE);
        if (!cell) return;
        const x = c.align === "right" ? colX[i] + colW[i] - 6 - textWidth(cell, CELL_SIZE) : colX[i] + 6;
        s += drawText(x, baseline, CELL_SIZE, "F1", cell);
      });
      y -= ROW_H;
    }

    // Footer
    const footLeft = footerNote ? sanitize(footerNote) : "";
    s += "0.55 0.58 0.62 rg\n";
    if (footLeft) s += drawText(MARGIN, MARGIN - 6, 8, "F1", fit(footLeft, CONTENT_W - 120, 8));
    const pageLabel = `Page ${pageIndex + 1} of ${pages.length}`;
    s += drawText(MARGIN + CONTENT_W - textWidth(pageLabel, 8), MARGIN - 6, 8, "F1", pageLabel);
    s += "0 g\n";

    return s;
  });

  // ---- Assemble the PDF objects ----
  const objects: string[] = [];
  const pageObjIds = pages.map((_, i) => 5 + i * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  streams.forEach((stream, i) => {
    const pageId = pageObjIds[i];
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    const bytes = Buffer.byteLength(stream, "latin1");
    objects[contentId] = `<< /Length ${bytes} >>\nstream\n${stream}endstream`;
  });

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (str: string) => {
    const buf = Buffer.from(str, "latin1");
    chunks.push(buf);
    offset += buf.length;
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  const xref: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    xref[id] = offset;
    push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }

  const startxref = offset;
  const count = objects.length; // objects[0] is the free entry
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) {
    table += `${String(xref[id]).padStart(10, "0")} 00000 n \n`;
  }
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
