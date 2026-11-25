/**
 * Local Expo Go must not require a signed EAS development certificate.
 * Keeping owner + eas.projectId in app.json forces Expo CLI to sign the
 * manifest; offline / unauthenticated starts then hang on a white spinner.
 * EAS Build still gets projectId via EXPO_NO_CAPABILITY_SYNC / EAS_BUILD.
 */
const appJson = require('./app.json');

const keepEasProject =
  process.env.EAS_BUILD === 'true' || process.env.EXPO_USE_EAS_PROJECT === '1';

module.exports = () => {
  const expo = JSON.parse(JSON.stringify(appJson.expo));

  if (!keepEasProject) {
    delete expo.owner;
    if (expo.extra && expo.extra.eas) {
      delete expo.extra.eas.projectId;
      if (Object.keys(expo.extra.eas).length === 0) {
        delete expo.extra.eas;
      }
    }
  }

  // Local testing without editing app.json:
  //   $env:EXPO_PREFER_LOCAL_API='1'; npx expo start
  // makes Expo Go call the LAN backend (runserver 0.0.0.0:8000) instead of apiUrl.
  if (process.env.EXPO_PREFER_LOCAL_API === '1') {
    expo.extra = { ...(expo.extra || {}), preferRemoteApiInDev: false };
  }
  // Point the app at any backend (e.g. an isolated test server) without editing app.json:
  //   $env:EXPO_API_URL='http://localhost:8010/api'; npx expo start --web
  if (process.env.EXPO_API_URL) {
    expo.extra = { ...(expo.extra || {}), apiUrl: process.env.EXPO_API_URL, preferRemoteApiInDev: true };
  }

  const plugins = Array.isArray(expo.plugins) ? [...expo.plugins] : [];
  if (!plugins.includes('expo-font')) plugins.push('expo-font');
  expo.plugins = plugins;

  return expo;
};
