/**
 * 51 — native iOS shell audit (static file checks, no emulator needed).
 *
 * The bug class this suite exists for: the native shell fails in ways no
 * TypeScript build can catch — a missing Info.plist usage description KILLS
 * the process the first time the camera opens (found live 2026-07-18: "take
 * photo" for a list cover crashed the app); a Swift file present on disk but
 * absent from pbxproj Sources silently doesn't compile (LiveActivityPlugin,
 * 2026-07-14); a missing `FirebaseApp.configure()` bricked native auth at
 * launch. Each assertion below is a real past incident or its direct sibling.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const INFO_PLIST = 'ios/App/App/Info.plist';
const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
const APP_DELEGATE = 'ios/App/App/AppDelegate.swift';

// ─── Privacy usage descriptions — iOS kills the process without them ──────

test('Info.plist: camera usage description present (file inputs offer "Take Photo")', () => {
  const plist = read(INFO_PLIST);
  assert.match(plist, /<key>NSCameraUsageDescription<\/key>\s*<string>.{10,}<\/string>/);
});

test('Info.plist: microphone usage description present (post composer records video)', () => {
  const plist = read(INFO_PLIST);
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>\s*<string>.{10,}<\/string>/);
});

test('Info.plist: photo-library add + read usage descriptions present (story "Save Image", pickers)', () => {
  const plist = read(INFO_PLIST);
  assert.match(plist, /<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>.{10,}<\/string>/);
  assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key>\s*<string>.{10,}<\/string>/);
});

test('Info.plist: export-compliance declared (skips the questionnaire on every upload)', () => {
  assert.match(read(INFO_PLIST), /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test('Info.plist: Live Activities + remote-notification background mode still declared', () => {
  const plist = read(INFO_PLIST);
  assert.match(plist, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
  assert.match(plist, /remote-notification/);
});

test('ShareExtension Info.plist: activation rule is the dictionary form, never TRUEPREDICATE', () => {
  // ITMS-90362 (found live 2026-07-20): TRUEPREDICATE works on every dev
  // build but App Store Connect rejects the upload. Only the dictionary
  // form is guaranteed valid for distribution.
  const plist = read('ios/App/ShareExtension/Info.plist');
  assert.ok(
    !/<string>\s*TRUEPREDICATE/.test(plist),
    'TRUEPREDICATE is dev-only — App Store Connect rejects it at upload (ITMS-90362)',
  );
  assert.match(plist, /<key>NSExtensionActivationSupportsWebURLWithMaxCount<\/key>/);
  assert.match(plist, /<key>NSExtensionActivationSupportsText<\/key>/);
});

// ─── pbxproj membership — a file on disk that isn't in Sources never builds ─

test('pbxproj: local plugins + relay are compiled into the App target', () => {
  const pbx = read(PBXPROJ);
  for (const file of [
    'LiveActivityPlugin.swift',
    'LiveActivityTokenRelay.swift',
    'SharedAuthPlugin.swift',
  ]) {
    assert.ok(
      pbx.includes(`${file} in Sources`),
      `${file} must appear "in Sources" in project.pbxproj — on disk but ` +
        'unreferenced means it silently does not compile (the App target is ' +
        'NOT a file-system-synchronized group).',
    );
  }
});

test('shared Live Activity attributes file exists (both targets sync it)', () => {
  assert.ok(existsSync(join(ROOT, 'ios/App/Shared/ScanActivityAttributes.swift')));
});

test('widget extension is a widgetkit extension', () => {
  const plist = read('ios/App/ScanActivityWidget/Info.plist');
  assert.match(plist, /com\.apple\.widgetkit-extension/);
});

// ─── Launch wiring — present-but-never-started is the same as absent ──────

test('AppDelegate: FirebaseApp.configure() runs unconditionally at launch', () => {
  const src = read(APP_DELEGATE);
  assert.ok(src.includes('FirebaseApp.configure()'));
  assert.ok(
    !/if\s+FirebaseApp\.app\(\)\s*==\s*nil/.test(src),
    'the nil-probe itself logs I-COR000003 — keep configure() unconditional',
  );
});

test('AppDelegate: LiveActivityTokenRelay starts from didFinishLaunching', () => {
  assert.ok(read(APP_DELEGATE).includes('LiveActivityTokenRelay.start()'));
});

// ─── Capacitor + entitlements invariants ──────────────────────────────────

test('capacitor.config: ios contentInset stays "never" (double top-inset regression)', () => {
  assert.match(read('capacitor.config.ts'), /contentInset:\s*'never'/);
});

test('entitlements: app + share extension share the App Group', () => {
  const group = 'group.com.cinechrony.shared';
  assert.ok(read('ios/App/App/App.entitlements').includes(group));
  assert.ok(read('ios/App/ShareExtension/ShareExtension.entitlements').includes(group));
});
