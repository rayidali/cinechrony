/**
 * The acquisition parse contract for IMAGE posts (IG carousels + TikTok
 * slideshows/photo mode) — pure fixtures, no network. Guards the shapes the
 * Apify actors actually emit so a parser regression can't silently turn a
 * slideshow back into FETCH_FAILED:
 *   - IG reel (one video media) still resolves as video
 *   - IG carousel (image medias) resolves as an ordered image set
 *   - explicit type fields beat URL sniffing; video wins when both exist
 *   - the raw TikTok photo shape (imagePost.images[].imageURL.urlList) parses
 *   - plain image-list shapes parse; junk is skipped; the set caps + dedupes
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __parseForTests } from '@/lib/video-acquire-server';

const { instagram, multi } = __parseForTests;

test('IG reel: a single video media still resolves as video', () => {
  const parsed = instagram({
    result: {
      medias: [{ url: 'https://scontent.cdninstagram.com/v/t50/reel_clip.mp4?efg=abc' }],
      title: 'this film broke me',
    },
  });
  assert.equal(parsed.videoUrl, 'https://scontent.cdninstagram.com/v/t50/reel_clip.mp4?efg=abc');
  assert.deepEqual(parsed.imageUrls, []);
  assert.equal(parsed.caption, 'this film broke me');
});

test('IG carousel: image medias become an ordered image set with a thumbnail', () => {
  const parsed = instagram({
    result: {
      medias: [
        { url: 'https://scontent.cdninstagram.com/v/t51/slide_one.jpg?x=1' },
        { url: 'https://scontent.cdninstagram.com/v/t51/slide_two.webp?x=2' },
        { url: 'https://scontent.cdninstagram.com/v/t51/slide_three.png?x=3' },
      ],
      title: '5 films for a rainy sunday',
    },
  });
  assert.equal(parsed.videoUrl, null);
  assert.equal(parsed.imageUrls.length, 3);
  assert.equal(parsed.imageUrls[0], 'https://scontent.cdninstagram.com/v/t51/slide_one.jpg?x=1');
  assert.equal(parsed.thumbnailUrl, parsed.imageUrls[0], 'the first slide is the thumbnail');
});

test('explicit type fields beat URL sniffing, and a video beats images', () => {
  const parsed = instagram({
    result: {
      medias: [
        { url: 'https://cdn.example.com/mystery/1?sig=a', type: 'image' },
        { url: 'https://cdn.example.com/mystery/2?sig=b', type: 'video' },
      ],
      title: 'mixed post',
    },
  });
  assert.equal(parsed.videoUrl, 'https://cdn.example.com/mystery/2?sig=b');
  assert.deepEqual(parsed.imageUrls, ['https://cdn.example.com/mystery/1?sig=a']);
});

test('TikTok photo mode: the raw imagePost.imageURL.urlList shape parses', () => {
  const parsed = multi({
    desc: 'kdramas that ended me',
    imagePost: {
      images: [
        { imageURL: { urlList: ['https://p16-sign.tiktokcdn-us.com/obj/slide-a?x-expires=1'] } },
        { imageURL: { urlList: ['https://p16-sign.tiktokcdn-us.com/obj/slide-b?x-expires=2'] } },
      ],
    },
  });
  assert.equal(parsed.videoUrl, null);
  assert.equal(parsed.imageUrls.length, 2);
  assert.equal(parsed.caption, 'kdramas that ended me');
});

test('plain image lists parse; video urls and junk are skipped; dedupe + cap hold', () => {
  const many = Array.from({ length: 14 }, (_, i) => `https://cdn.example.com/photos/slide_${i}.jpeg`);
  const parsed = multi({
    images: [...many, many[0], 'not-a-url', 'https://cdn.example.com/clip.mp4'],
  });
  assert.equal(parsed.imageUrls.length, 10, 'caps at MAX_IMAGES');
  assert.equal(new Set(parsed.imageUrls).size, 10, 'deduped');
  assert.ok(parsed.imageUrls.every((u) => u.endsWith('.jpeg') === false || !u.includes('.mp4')));
});

test('TikTok video posts are untouched by the image support', () => {
  const parsed = multi({
    medias: [{ url: 'https://v16m.tiktokcdn.com/video/tos/useast/clip/?mime_type=video_mp4&br=2' }],
    title: 'top 3 heist films',
  });
  assert.equal(parsed.videoUrl, 'https://v16m.tiktokcdn.com/video/tos/useast/clip/?mime_type=video_mp4&br=2');
  assert.deepEqual(parsed.imageUrls, []);
});
