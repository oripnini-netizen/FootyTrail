module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // No "expo-router/babel" plugin needed on SDK 50+
  };
};
