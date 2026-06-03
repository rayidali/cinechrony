## App icon + splash source artwork

This directory is the input for `@capacitor/assets`, which regenerates every required iOS / Android icon size from a single high-res source.

### Files to drop in here

| File              | Size        | Notes                                                        |
|-------------------|-------------|--------------------------------------------------------------|
| `icon.png`        | 1024 × 1024 | Square. No transparency. Will be auto-rounded by iOS.        |
| `icon-dark.png`   | 1024 × 1024 | (optional) Variant used when the user is in iOS dark mode.   |
| `splash.png`      | 2732 × 2732 | Logo centered. Cream `#f7f3eb` background. Most edges crop.  |
| `splash-dark.png` | 2732 × 2732 | (optional) Dark-mode splash. Ink `#0a0a0a` background.       |

### Regenerate all sizes after replacing artwork

```bash
npx capacitor-assets generate \
  --iconBackgroundColor '#f7f3eb' \
  --iconBackgroundColorDark '#0a0a0a' \
  --splashBackgroundColor '#f7f3eb' \
  --splashBackgroundColorDark '#0a0a0a'
```

This writes into `ios/App/App/Assets.xcassets/AppIcon.appiconset/` and `android/app/src/main/res/mipmap-*/` automatically. Commit the regenerated files alongside the source artwork.
