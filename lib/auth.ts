import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const AUTH_KEY = 'horacle_user';

export interface HoracleUser {
  id: string;
  world_id_nullifier: string;
  wallet_address: string;
  display_name: string | null;
  reputation_score: number;
  total_earned_usdc: number;
  total_queries_answered: number;
}

export async function saveUser(user: HoracleUser): Promise<void> {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(user));
}

export async function getUser(): Promise<HoracleUser | null> {
  const data = await SecureStore.getItemAsync(AUTH_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function clearUser(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_KEY);
}

/**
 * Register a new user after World ID verification
 */
export async function registerUser(
  nullifierHash: string,
  walletAddress: string
): Promise<{ user?: HoracleUser; error?: string }> {
  // Check if already registered
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('world_id_nullifier', nullifierHash)
    .single();

  if (existing) {
    // Already registered — just log them in
    const user: HoracleUser = {
      id: existing.id,
      world_id_nullifier: existing.world_id_nullifier,
      wallet_address: existing.wallet_address,
      display_name: existing.display_name,
      reputation_score: existing.reputation_score,
      total_earned_usdc: existing.total_earned_usdc,
      total_queries_answered: existing.total_queries_answered,
    };
    await saveUser(user);
    return { user };
  }

  // Create new user
  const { data, error } = await supabase
    .from('users')
    .insert({
      world_id_nullifier: nullifierHash,
      wallet_address: walletAddress,
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  const user: HoracleUser = {
    id: data.id,
    world_id_nullifier: data.world_id_nullifier,
    wallet_address: data.wallet_address,
    display_name: data.display_name,
    reputation_score: data.reputation_score,
    total_earned_usdc: data.total_earned_usdc,
    total_queries_answered: data.total_queries_answered,
  };

  await saveUser(user);
  return { user };
}
