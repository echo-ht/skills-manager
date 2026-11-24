# Android asset sources

`icon.png` is derived from the existing Skills Manager app icon at `src-tauri/icons/icon.png`. It was upscaled from 512×512 to 1024×1024 with Lanczos resampling for `@capacitor/assets`; no new artwork was generated.

Regenerate Android launcher and splash resources with:

```bash
npx @capacitor/assets generate --android --assetPath android-assets \
  --iconBackgroundColor '#f6f8f7' \
  --iconBackgroundColorDark '#0d1411' \
  --splashBackgroundColor '#f6f8f7' \
  --splashBackgroundColorDark '#0d1411'
```
