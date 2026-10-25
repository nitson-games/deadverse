import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBlocks,
  serializeBlocks,
  imageSourcesOf,
  mediaIdsInBody,
  invalidImageRefs,
  articleBodyError,
  isImageSrc,
  MAX_INLINE_IMAGES
} from '../server/blocks.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configSource = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

/** The browser copy of the same rules, run the way a browser would run it. */
function browserBlocks() {
  const window = { location: { protocol: 'https:', hostname: 'www.deadverse.ir', search: '' } };
  window.window = window;
  vm.runInNewContext(configSource, { window, URLSearchParams });
  return window.DEADVERSE.blocks;
}

const MEDIA = '/api/media/md_abc123';
const OTHER = 'https://example.com/x/cover.jpg';

test('a body is read as the blocks it was written from', () => {
  const text = `پاراگراف اول\nادامه‌ی همان پاراگراف\n\n[[img:${MEDIA}]]\n\nپاراگراف دوم`;
  assert.deepEqual(parseBlocks(text), [
    { kind: 'text', text: 'پاراگراف اول\nادامه‌ی همان پاراگراف' },
    { kind: 'image', url: MEDIA },
    { kind: 'text', text: 'پاراگراف دوم' }
  ]);
});

test('serializing is the exact inverse of parsing', () => {
  const blocks = [
    { kind: 'text', text: '  اول  ' },
    { kind: 'image', url: MEDIA },
    { kind: 'text', text: '  ' },
    { kind: 'text', text: 'دوم' }
  ];
  const text = serializeBlocks(blocks);
  assert.equal(text, `اول\n\n[[img:${MEDIA}]]\n\nدوم`, 'بلوک خالی ذخیره نمی‌شود');
  assert.deepEqual(parseBlocks(text), [
    { kind: 'text', text: 'اول' },
    { kind: 'image', url: MEDIA },
    { kind: 'text', text: 'دوم' }
  ]);
  assert.equal(serializeBlocks(parseBlocks(text)), text, 'دوباره نوشتن باید همان متن بدهد');
});

test('a paragraph that shows the marker syntax keeps its own text', () => {
  const blocks = [{ kind: 'text', text: `مثال:\n[[img:${MEDIA}]]` }];
  const text = serializeBlocks(blocks);
  assert.equal(text, `مثال:\n\\[[img:${MEDIA}]]`, 'خطی که شبیه بلوک تصویری است فرار می‌کند');
  const back = parseBlocks(text);
  assert.equal(back.length, 1, 'فقط یک بلوک وجود دارد، نه یک تصویر');
  assert.equal(back[0].kind, 'text');
  assert.equal(back[0].text, `مثال:\n[[img:${MEDIA}]]`, 'نویسه‌ی فرار به متن برنمی‌گردد');
});

test('only an address the page can load becomes a picture', () => {
  assert.ok(isImageSrc(MEDIA));
  assert.ok(isImageSrc(OTHER));
  assert.ok(!isImageSrc('javascript:alert(1)'));
  assert.ok(!isImageSrc('/api/media/not_an_id'));
  assert.ok(!isImageSrc('data:image/svg+xml,<svg/>'));
  assert.ok(!isImageSrc(''));
  // A marker with an address like that is text, never an <img> tag.
  const blocks = parseBlocks('[[img:javascript:alert(1)]]');
  assert.equal(blocks[0].kind, 'text');
});

test('the ids of the bytes behind a body are recoverable from it', () => {
  const text = `متن\n\n[[img:${MEDIA}]]\n\n[[img:${OTHER}]]`;
  assert.deepEqual(imageSourcesOf(text), [MEDIA, OTHER]);
  assert.deepEqual(mediaIdsInBody(text), ['md_abc123'], 'آدرس بیرونی مدیایی برای حذف ندارد');
});

test('a hand-typed marker that cannot load is reported, not stored', () => {
  assert.deepEqual(invalidImageRefs(`[[img:javascript:alert(1)]]`), ['[[img:javascript:alert(1)]]']);
  assert.deepEqual(invalidImageRefs(`[[img:${MEDIA}]]`), []);
  assert.deepEqual(invalidImageRefs('\\[[img:whatever]]'), [], 'خط فرار شده پاراگراف است');
  assert.ok(articleBodyError('[[img:http://x.example/a.jpg]]'), 'http به‌جای https رد می‌شود');
  assert.equal(articleBodyError(`[[img:${MEDIA}]]`), null);
  assert.equal(articleBodyError('متن ساده بدون تصویر'), null);
});

test('an article cannot hold an endless wall of pictures', () => {
  const many = Array.from({ length: MAX_INLINE_IMAGES + 1 }, () => `[[img:${MEDIA}]]`).join('\n\n');
  assert.match(String(articleBodyError(many)), /حداکثر/);
  const exactly = Array.from({ length: MAX_INLINE_IMAGES }, () => `[[img:${MEDIA}]]`).join('\n\n');
  assert.equal(articleBodyError(exactly), null);
});

test('the panel and the page read a body the same way', () => {
  const client = browserBlocks();
  const corpus = [
    '',
    'یک پاراگراف',
    `پاراگراف\nخط دوم\n\n[[img:${MEDIA}]]\n\n[[img:${OTHER}]]`,
    `[[img:${MEDIA}]]`,
    `\\[[img:${MEDIA}]]`,
    '[[img:javascript:alert(1)]',
    `[[img:${MEDIA}]]\n[[img:/api/media/bad-id]]`,
    '  ',
    `[[img:${MEDIA}]]\n\n\n\nپاراگراف`
  ];
  // Objects built inside the sandbox belong to that realm; compare their shape
  // field by field instead of the objects themselves — and rebuild the list in
  // this realm, because `.map()` would hand back an array from the other one.
  const shaped = (list) => Array.from(list, (block) =>
    block.kind === 'image' ? { kind: 'image', url: block.url } : { kind: 'text', text: block.text }
  );
  for (const text of corpus) {
    const server = parseBlocks(text);
    const browser = client.parse(text);
    assert.deepEqual(shaped(browser), shaped(server), `parse: ${text}`);
    assert.equal(client.serialize(browser), serializeBlocks(server), `serialize: ${text}`);
    assert.deepEqual(Array.from(client.images(text)), imageSourcesOf(text), `images: ${text}`);
    assert.deepEqual(Array.from(client.badImages(text)), invalidImageRefs(text), `badImages: ${text}`);
    assert.equal(client.isImageSrc(MEDIA), isImageSrc(MEDIA));
    assert.equal(client.isImageSrc('javascript:alert(1)'), isImageSrc('javascript:alert(1)'));
  }
});
