import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aminoulogie.candlechase',
  appName: 'Candlechase',
  webDir: 'dist',
  backgroundColor: '#0b0e13',
  ios: {
    // the web app handles the notch and home bar itself (env(safe-area-inset-*))
    contentInset: 'never',
    backgroundColor: '#0b0e13',
    scrollEnabled: false,
  },
};

export default config;
