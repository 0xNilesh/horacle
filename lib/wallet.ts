import { Alert } from 'react-native';
import { supabase } from './supabase';
import { getUser } from './auth';

/**
 * Check if user has a real wallet connected (not the placeholder from nullifier)
 */
export async function hasRealWallet(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;

  // Check if wallet is a real Dynamic wallet (not derived from nullifier)
  // Placeholder wallets are sliced from nullifier: 0x + nullifier[2:42]
  // Real wallets come from Dynamic
  const { data } = await supabase
    .from('users')
    .select('wallet_address')
    .eq('id', user.id)
    .single();

  if (!data?.wallet_address) return false;

  // If wallet matches the nullifier pattern, it's a placeholder
  const isPlaceholder = data.wallet_address === `0x${user.world_id_nullifier.slice(2, 42)}`;
  return !isPlaceholder;
}

/**
 * Get the user's wallet address
 */
export async function getWalletAddress(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('wallet_address')
    .eq('id', user.id)
    .single();

  return data?.wallet_address || null;
}

/**
 * Update wallet address in Supabase after Dynamic connection
 */
export async function saveWalletAddress(walletAddress: string): Promise<void> {
  const user = await getUser();
  if (!user) return;

  await supabase
    .from('users')
    .update({ wallet_address: walletAddress })
    .eq('id', user.id);
}
