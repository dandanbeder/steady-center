/**
 * Branded Journal PDF generator.
 *
 * Runs entirely in the user's browser session via jsPDF, no entry content
 * leaves the device. The Heartbeat logo is loaded from the project's CDN
 * asset so the brand mark renders reliably. Footer year is computed at
 * generation time so the copyright never goes stale.
 */
import { jsPDF } from "jspdf";
import { format, parseISO } from "date-fns";
import heartbeatLogoAsset from "@/assets/heartbeat-email-logo.png.asset.json";
import { MOOD_LABELS, type JournalMeta } from "@/lib/journal";

export type JournalPdfEntry = {
  id: string;
  created_at: string;
  title: string;
  body: string;
  meta: JournalMeta | null;
};

const PAGE_MARGIN = 56; // ~0.78"
const HEADER_TOP = 28;
const FOOTER_BOTTOM = 28;
const HEADER_LOGO_H = 18;
const COMPANY = "FlightMed (PTY) Ltd";

// Cache the logo bytes across calls within a session.
let logoDataUrlPromise: Promise<string | null> | null = null;
async function loadLogoDataUrl(): Promise<string | null> {
  if (logoDataUrlPromise) return logoDataUrlPromise;
  logoDataUrlPromise = (async () => {
    try {
      const res = await fetch(heartbeatLogoAsset.url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  return logoDataUrlPromise;
}

function drawChrome(doc: jsPDF, logo: string | null) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ----- Header: logo + wordmark in top-right -----
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  const wordmark = "Heartbeat";
  const wordmarkW = doc.getTextWidth(wordmark);
  const wordmarkX = pageW - PAGE_MARGIN;
  const wordmarkY = HEADER_TOP + HEADER_LOGO_H / 2 + 3.5;
  doc.text(wordmark, wordmarkX, wordmarkY, { align: "right" });

  if (logo) {
    try {
      const logoW = HEADER_LOGO_H; // square-ish
      const logoX = wordmarkX - wordmarkW - 8 - logoW;
      const logoY = HEADER_TOP;
      doc.addImage(logo, "PNG", logoX, logoY, logoW, HEADER_LOGO_H);
    } catch {
      // Logo failed to embed; wordmark alone is enough.
    }
  }

  // Thin rule under the header.
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(
    PAGE_MARGIN,
    HEADER_TOP + HEADER_LOGO_H + 8,
    pageW - PAGE_MARGIN,
    HEADER_TOP + HEADER_LOGO_H + 8,
  );

  // ----- Footer: centered copyright -----
  const year = new Date().getFullYear();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text(
    `\u00A9 ${year} ${COMPANY}. All rights reserved.`,
    pageW / 2,
    pageH - FOOTER_BOTTOM,
    { align: "center" },
  );
  doc.setTextColor(0, 0, 0);
}

/** Pure-text markdown sanitiser: strip leading #, *, -, > markers per line. */
function flattenMarkdown(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s+)/, ""))
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function contentBox(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const top = HEADER_TOP + HEADER_LOGO_H + 22;
  const bottom = pageH - FOOTER_BOTTOM - 14;
  return {
    left: PAGE_MARGIN,
    right: pageW - PAGE_MARGIN,
    top,
    bottom,
    width: pageW - PAGE_MARGIN * 2,
    pageH,
  };
}

function ensureSpace(
  doc: jsPDF,
  y: number,
  needed: number,
  logo: string | null,
): number {
  const box = contentBox(doc);
  if (y + needed > box.bottom) {
    doc.addPage();
    drawChrome(doc, logo);
    return box.top;
  }
  return y;
}

function renderEntry(
  doc: jsPDF,
  entry: JournalPdfEntry,
  startY: number,
  logo: string | null,
): number {
  const box = contentBox(doc);
  let y = startY;

  // Date eyebrow
  const d = parseISO(entry.created_at);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  y = ensureSpace(doc, y, 14, logo);
  doc.text(format(d, "EEEE, MMMM d, yyyy").toUpperCase(), box.left, y);
  y += 14;

  // Title, Fraunces-like serif via jsPDF's built-in "times" (Fraunces isn't
  // bundled; "times" keeps the Calm Wave serif feel without shipping fonts).
  const title = entry.title?.trim() || "Untitled entry";
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  const titleLines = doc.splitTextToSize(title, box.width);
  y = ensureSpace(doc, y, titleLines.length * 24, logo);
  doc.text(titleLines, box.left, y);
  y += titleLines.length * 24;

  // Mood + tags
  const moodLabel = entry.meta?.mood ? MOOD_LABELS[entry.meta.mood] : null;
  const tags = entry.meta?.tags ?? [];
  if (moodLabel || tags.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    const parts: string[] = [];
    if (moodLabel) parts.push(`Mood: ${moodLabel}`);
    if (tags.length) parts.push(`Tags: ${tags.join(", ")}`);
    const metaLines = doc.splitTextToSize(parts.join("   ·   "), box.width);
    y = ensureSpace(doc, y, metaLines.length * 14 + 4, logo);
    doc.text(metaLines, box.left, y);
    y += metaLines.length * 14 + 4;
  }

  // Soft divider
  y = ensureSpace(doc, y, 14, logo);
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.5);
  doc.line(box.left, y, box.left + 48, y);
  y += 14;

  // Body
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  const lineH = 16;
  const bodyText = flattenMarkdown(entry.body || "");
  const paragraphs = bodyText.split(/\n{2,}/);
  for (const para of paragraphs) {
    const lines = doc.splitTextToSize(para.replace(/\n/g, " "), box.width);
    for (const line of lines) {
      y = ensureSpace(doc, y, lineH, logo);
      doc.text(line, box.left, y);
      y += lineH;
    }
    y += 6; // paragraph spacing
  }

  doc.setTextColor(0, 0, 0);
  return y;
}

export async function generateJournalPdf(
  entries: JournalPdfEntry[],
  options: { filename: string },
): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const logo = await loadLogoDataUrl();

  drawChrome(doc, logo);
  const box = contentBox(doc);
  let y = box.top;

  if (entries.length === 0) {
    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.setTextColor(120, 120, 120);
    doc.text("No journal entries to export.", box.left, y);
  } else {
    entries.forEach((entry, idx) => {
      if (idx > 0) {
        // New entry starts on a fresh page so each one has clean breathing room.
        doc.addPage();
        drawChrome(doc, logo);
        y = box.top;
      }
      y = renderEntry(doc, entry, y, logo);
    });
  }

  doc.save(options.filename);
}
