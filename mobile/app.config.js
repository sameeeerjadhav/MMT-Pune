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

  const plugins = Array.isArray(expo.plugins) ? [...expo.plugins] : [];
  if (!plugins.includes('expo-font')) plugins.push('expo-font');
  expo.plugins = plugins;

  return expo;
};
