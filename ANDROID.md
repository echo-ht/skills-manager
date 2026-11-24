# Android Remote Repository App

The Android build is a Capacitor application that reuses the Skills Manager visual language and repository metadata protocol while presenting a phone-first Material 3 interface.

## Data flow

1. The user connects a GitHub repository with a personal access token.
2. Isomorphic Git clones the repository into persistent app-local storage.
3. Skills and presets are read from the working tree and `.skills-manager` metadata.
4. “Install from GitHub” clones another repository, previews every `SKILL.md`, copies selected skills, and records their original URL, branch, and subdirectory in desktop-compatible metadata.
5. “Check updates” compares Git-sourced skill directories with their upstream repositories. Updating replaces only skill content while preserving tags and preset membership.
6. Each UI mutation writes the complete set of affected files, stages them, and creates one commit.
7. The app pushes that commit automatically. If push fails, the local commit remains and is shown as pending.
8. On launch or refresh, the app fetches the upstream branch and fast-forwards only when that cannot overwrite local work.

SSH remotes are accepted as input and normalized to HTTPS because the Android app authenticates with a GitHub token.

## Build

Android packaging runs in GitHub Actions:

```bash
npm ci
npm run build
npm run android:sync
cd android
./gradlew assembleDebug
```

The Capacitor 8 command line requires Node.js 22 or newer. The workflow uses Node.js 24 and Java 21.

Use the **Build Android APK** workflow in GitHub Actions and download the `skills-manager-android-debug` artifact.

Main-branch APKs use one persistent signing key stored only in GitHub Actions Secrets, and each build gets a higher `versionCode`. After the first transition from an older randomly-signed APK, uninstall once; later builds install over the existing app without clearing its data.
