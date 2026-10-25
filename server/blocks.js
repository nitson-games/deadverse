import { MEDIA_REF_PREFIX, mediaIdOf } from './media.js';

/**
 * An article body is a sequence of blocks the panel places in the order it
 * wants: paragraphs of text and pictures. It still travels as plain text — the
 * gated page streams text, the anti-spam limits stay in characters, and an old
 * article with no markers renders exactly as before — and one picture is one
 * line: `[[img:<url>]]`.
 *
 * config.js carries the same parser for the browser. tests/blocks.test.js runs
 * both over one corpus, so the two copies cannot drift apart unnoticed.
 *
 * A paragraph that has to *show* that syntax escapes it with a leading
 * backslash; the parser gives the backslash back and keeps the line as text.
 */
export const IMAGE_LINE = /^\[\[img:([^\]\s]+)\]\]$/;
export const MAX_INLINE_IMAGES = 24;

const ESCAPED_IMAGE_LINE = /^\\\[\[img:/;

/** Only these two shapes may become an <img src> on a public page. */
export function isImageSrc(value) {
  if (typeof value !== 'string') return false;
  if (/^https:\/\/[^\s<>"'`]+$/i.test(value)) return true;
  return value.startsWith(MEDIA_REF_PREFIX) && mediaIdOf(value) !== '';
}

function unescapeLine(line) {
  return ESCAPED_IMAGE_LINE.test(line) ? line.slice(1) : line;
}

function escapeLine(line) {
  return IMAGE_LINE.test(line) ? `\\${line}` : line;
}

/** Text as the admin wrote it → the blocks the editor shows. */
export function parseBlocks(text) {
  const blocks = [];
  for (const chunk of String(text || '').trim().split(/\n{2,}/)) {
    if (!chunk.trim()) continue;
    const match = IMAGE_LINE.exec(chunk.trim());
    if (match && isImageSrc(match[1])) {
      blocks.push({ kind: 'image', url: match[1] });
      continue;
    }
    blocks.push({ kind: 'text', text: chunk.split('\n').map(unescapeLine).join('\n') });
  }
  return blocks;
}

/** The editor's blocks → the text that is stored. Empty blocks disappear. */
export function serializeBlocks(blocks) {
  return (blocks || [])
    .map((block) => {
      if (block.kind === 'image') return isImageSrc(block.url) ? `[[img:${block.url}]]` : '';
      return String(block.text || '')
        .trim()
        .split('\n')
        .map(escapeLine)
        .join('\n');
    })
    .filter((chunk) => chunk !== '')
    .join('\n\n');
}

/** Every image address a body refers to, in the order they appear. */
export function imageSourcesOf(text) {
  return parseBlocks(text)
    .filter((block) => block.kind === 'image')
    .map((block) => block.url);
}

/** Ids of the bytes stored in the database; external URLs own nothing to free. */
export function mediaIdsInBody(text) {
  return imageSourcesOf(text).map(mediaIdOf).filter(Boolean);
}

/**
 * A body may not smuggle an address the page would happily load. Anything that
 * looks like a picture line but is not a storable image is reported, so the
 * panel gets a field error instead of a broken <img>.
 */
export function invalidImageRefs(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('\\['))
    .filter((line) => /^\[\[img:/.test(line))
    .filter((line) => {
      const match = IMAGE_LINE.exec(line);
      return !match || !isImageSrc(match[1]);
    });
}

export function articleBodyError(text) {
  const bad = invalidImageRefs(text);
  if (bad.length) {
    return 'تصویر داخل متن باید با https:// شروع شود یا /api/media/… باشد';
  }
  const sources = imageSourcesOf(text);
  if (sources.length > MAX_INLINE_IMAGES) {
    return `هر مقاله حداکثر ${MAX_INLINE_IMAGES} تصویر داخل متن می‌تواند داشته باشد`;
  }
  return null;
}
