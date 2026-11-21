# Mobile app notes (Expo / React Native)

This is an Expo SDK 58 React Native TypeScript app for warehouse operations.

## Navigation

Use **React Navigation** (`@react-navigation/native`, native-stack, bottom-tabs).

- Entry: `index.ts` → `App.tsx` → `src/navigation/RootNavigator.tsx`
- Screens live under `src/screens/`
- Shared UI: `src/components/`, API: `src/api/`, hardware HAL: `src/services/hardware/`
- Role helpers: `src/utils/roles.ts` (tabs and module gates differ per login)

Do **not** migrate to Expo Router unless explicitly requested.

## Commands

```bash
npx expo install <package>   # prefer over npm add for native modules
npx expo start               # phone via Expo Go
npx expo start --web         # optional PC browser demo
npx tsc --noEmit
npx expo-doctor
```

## API & auth storage

- Axios client: `src/api/client.ts` (JWT refresh)
- Endpoints: `src/api/endpoints.ts`
- Storage helper: `src/utils/secureStorage.ts`
  - Device: Expo SecureStore
  - Web: `localStorage` (PC testing only)
- Screens must call live backend APIs — no permanent dummy inventory data

## Hardware

- Camera scanning: `expo-camera` on Scanner screen
- Zebra DataWedge / Link-OS: stubs only in `src/services/hardware/`
- Do not claim physical Zebra integration is complete until device-tested

## Building

Use EAS for APK/AAB when ready (`npx eas-cli@latest build`). Configure native behavior via `app.json` / config plugins; do not hand-edit generated `android/` / `ios/` if using CNG.
