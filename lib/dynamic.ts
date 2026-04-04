import { createClient } from '@dynamic-labs/client';
import { ReactNativeExtension } from '@dynamic-labs/react-native-extension';
import { ViemExtension } from '@dynamic-labs/viem-extension';
import { useReactiveClient } from '@dynamic-labs/react-hooks';

const environmentId = process.env.EXPO_PUBLIC_DYNAMIC_ENV_ID || '';

export const dynamicClient = createClient({
  environmentId,
  appName: 'Horacle',
  appLogoUrl: 'https://horacle.app/icon.png',
})
  .extend(
    ReactNativeExtension({
      appOrigin: 'https://horacle.app',
    })
  )
  .extend(ViemExtension());

export const useDynamic = () => {
  const client = useReactiveClient(dynamicClient);

  // Log state for debugging
  console.log('[Dynamic] Auth token:', client.auth?.token ? 'exists' : 'none');
  console.log('[Dynamic] Wallets:', client.wallets?.userWallets?.length || 0);

  return client;
};

export const showDynamicAuth = () => {
  try {
    dynamicClient.ui.auth.show();
  } catch (err) {
    console.log('[Dynamic] Could not show auth:', err);
  }
};
