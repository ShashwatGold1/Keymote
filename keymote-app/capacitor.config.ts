import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.keymote.app',
  appName: 'Keymote',
  webDir: 'src',
  android: {
    allowMixedContent: true
  }
};

export default config;
