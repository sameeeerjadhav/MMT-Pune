# Mobile app notes (Expo / React Native)

This is an Expo SDK 58 React Native TypeScript app for warehouse operations.

## Navigation

Use **React Navigation** (`@react-navigation/native`, native-stack, bottom-tabs).

- Entry: `index.ts` → `App.tsx` → `src/navigation/RootNavigator.tsx`
- Screens live under `src/screens/`
- Shared UI: `src/components/`, API: `src/api/`, hardware HAL: `src/services/hardware/`

Do **not** migrate to Expo Router unless explicitly requested. The master project prompt and current app use React Navigation.

## Commands

```bash
npx expo install <package>   # prefer over npm add for native modules
npx expo start
npx tsc --noEmit
npx expo-doctor
```

## API

- Axios client in `src/api/client.ts` (JWT in SecureStore, auto refresh)
- Endpoints in `src/api/endpoints.ts`
- Screens must call live backend APIs — no permanent dummy inventory data

## Hardware

- Camera scanning: `expo-camera` on Scanner screen
- Zebra DataWedge / Link-OS: stubs only in `src/services/hardware/`
- Do not claim physical Zebra integration is complete until device-tested

## Building

Use EAS for APK/AAB when ready (`npx eas-cli@latest build`). Configure native behavior via `app.json` / config plugins; do not hand-edit generated `android/` / `ios/` if using CNG.
