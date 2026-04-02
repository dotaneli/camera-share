const { withPodfile } = require('@expo/config-plugins');

module.exports = function withFirebaseFix(config) {
  return withPodfile(config, (config) => {
    const contents = config.modResults.contents;
    // Add CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES to fix
    // @react-native-firebase build failure on Expo SDK 54 / RN 0.81
    if (!contents.includes('CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES')) {
      config.modResults.contents = contents.replace(
        'react_native_post_install(',
        'installer.pods_project.build_configurations.each do |cfg|\n' +
        '      cfg.build_settings["CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES"] = "YES"\n' +
        '    end\n\n    react_native_post_install('
      );
    }
    return config;
  });
};
