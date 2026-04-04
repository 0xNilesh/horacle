import { StyleSheet, TouchableOpacity, ScrollView, Image, TextInput, Share } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { reverseGeocode } from '@/lib/geocode';
import { getCurrentLocation } from '@/lib/location';
import { useDynamic, showDynamicAuth, dynamicClient } from '@/lib/dynamic';
import { saveWalletAddress } from '@/lib/wallet';
import { getUSDCBalance } from '@/lib/payment';
import { router } from 'expo-router';

export default function ProfileScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [queryCount, setQueryCount] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [depositing, setDepositing] = useState(false);
  const [depositAmount, setDepositAmount] = useState('1');
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositStatus, setDepositStatus] = useState('');
  const [gatewayBalance, setGatewayBalance] = useState('');

  // Dynamic wallet
  const dynamicState = useDynamic();
  const connectedWallets = dynamicState?.wallets?.userWallets || [];
  const primaryWallet = dynamicState?.wallets?.primary;
  const walletAddress = primaryWallet?.address || connectedWallets?.[0]?.address;

  // Fetch USDC balance + Gateway balance
  useEffect(() => {
    if (walletAddress) {
      getUSDCBalance().then(setUsdcBalance);
    }
    // Fetch user's Gateway balance
    if (walletAddress) {
      (async () => {
        try {
          const { createPublicClient: createPC, http: httpT } = await import('viem');
          const pc = createPC({
            chain: { id: 4801, name: 'World Chain Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-sepolia.g.alchemy.com/v2/aIjBlwgkuTtigyA192G1h'] } } },
            transport: httpT(),
          });
          const USDC = '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88';
          const GATEWAY = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
          const bal = await pc.readContract({
            address: GATEWAY,
            abi: [{
              name: 'availableBalance',
              type: 'function',
              inputs: [
                { name: 'token', type: 'address' },
                { name: 'depositor', type: 'address' },
              ],
              outputs: [{ name: '', type: 'uint256' }],
              stateMutability: 'view',
            }],
            functionName: 'availableBalance',
            args: [USDC, walletAddress],
          });
          setGatewayBalance((Number(bal) / 1e6).toFixed(2));
        } catch (err) {
          console.log('[Profile] Gateway balance error:', err);
        }
      })();
    }
  }, [walletAddress]);

  // Auto-create embedded wallet if authenticated but no wallet
  useEffect(() => {
    const autoCreate = async () => {
      if (dynamicState?.auth?.token && !walletAddress) {
        console.log('[Profile] Auth exists but no wallet — creating embedded wallet...');
        try {
          await dynamicState.wallets.embedded.createWallet({ chain: 'Evm' });
          console.log('[Profile] Embedded wallet created');
        } catch (err) {
          console.log('[Profile] Create wallet error:', err);
        }
      }
    };
    autoCreate();
  }, [dynamicState?.auth?.token, walletAddress]);

  // Save wallet to Supabase when connected
  useEffect(() => {
    if (walletAddress && user) {
      saveWalletAddress(walletAddress);
      console.log('[Profile] Wallet saved:', walletAddress);
    }
  }, [walletAddress, user]);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const u = await getUser();
    setUser(u);
    if (!u) return;

    // Check if user has a display name set
    if (u.display_name) setUsername(u.display_name);

    // Get location
    const loc = await getCurrentLocation();
    if (loc) {
      const name = await reverseGeocode(loc.lat, loc.lng);
      setPlaceName(name);
    }

    // Fresh stats from DB
    const { data: freshUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', u.id)
      .single();

    if (freshUser) {
      setUser({
        ...u,
        reputation_score: freshUser.reputation_score,
        total_earned_usdc: freshUser.total_earned_usdc,
        total_queries_answered: freshUser.total_queries_answered,
      });
    }

    const { count: sessions } = await supabase
      .from('live_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.id);
    setSessionCount(sessions || 0);

    const { count: queries } = await supabase
      .from('queries')
      .select('id', { count: 'exact', head: true })
      .eq('asker_id', u.id);
    setQueryCount(queries || 0);
  };

  const handleSignOut = async () => {
    await clearUser();
    router.replace('/(auth)/verify');
  };

  if (!user) return null;

  return (
    <View style={s.container}>
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>🧑‍💻</Text>
          </View>

          {editingName ? (
            <View style={s.nameEditWrap}>
              <Text style={s.nameEditLabel}>Enter your World App username</Text>
              <View style={s.nameEditRow}>
                <TextInput
                  style={s.nameInput}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="e.g. nilesh"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  autoFocus
                  maxLength={30}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[s.nameSaveBtn, !nameInput.trim() && { opacity: 0.4 }]}
                  disabled={!nameInput.trim()}
                  onPress={async () => {
                    const trimmed = nameInput.trim();
                    if (!trimmed) return;
                    // Fetch from World username API
                    const { getWorldUsername } = await import('@/lib/username');
                    // Try looking up by username
                    try {
                      const res = await fetch('https://usernames.worldcoin.org/api/v1/query', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ addresses: [], usernames: [trimmed] }),
                      });
                      const data = await res.json();
                      if (data.length > 0) {
                        const worldUser = data[0];
                        // Save username, wallet address, and profile pic
                        await supabase.from('users').update({
                          display_name: worldUser.username,
                          wallet_address: worldUser.address,
                        }).eq('id', user.id);
                        setUsername(worldUser.username);
                        if (worldUser.profile_picture_url) setProfilePic(worldUser.profile_picture_url);
                        // Update local user
                        setUser({ ...user, display_name: worldUser.username, wallet_address: worldUser.address });
                      } else {
                        // Username not found — just save as display name
                        await supabase.from('users').update({ display_name: trimmed }).eq('id', user.id);
                        setUsername(trimmed);
                      }
                    } catch {
                      await supabase.from('users').update({ display_name: trimmed }).eq('id', user.id);
                      setUsername(trimmed);
                    }
                    setEditingName(false);
                  }}
                >
                  <Text style={s.nameSaveText}>Link</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => { setNameInput(username || ''); setEditingName(true); }}>
              <Text style={s.displayName}>{username || 'Link World Username'}</Text>
              {!username && <Text style={s.nameHint}>Tap to connect your World App profile</Text>}
            </TouchableOpacity>
          )}

          <View style={s.verifiedBadge}>
            <Text style={s.verifiedText}>🛡️ World ID Verified</Text>
          </View>
        </View>

        {/* Wallet */}
        {walletAddress ? (
          <View style={s.walletCard}>
            <View style={s.walletHeader}>
              <Text style={s.walletLabel}>WALLET CONNECTED</Text>
              <View style={s.walletDot} />
            </View>
            <TouchableOpacity
              style={s.walletCopyRow}
              onPress={() => Share.share({ message: walletAddress })}
            >
              <Text style={s.walletAddress} numberOfLines={1}>{walletAddress}</Text>
              <Text style={s.copyIcon}>📋</Text>
            </TouchableOpacity>
            <Text style={s.walletBalance}>{usdcBalance} USDC</Text>
            {gatewayBalance && gatewayBalance !== '0' ? (
              <Text style={s.gatewayBalance}>Gateway: {gatewayBalance} USDC</Text>
            ) : null}
            {/* Deposit button */}
            {!showDeposit ? (
              <TouchableOpacity style={s.depositBtn} onPress={() => setShowDeposit(true)}>
                <Text style={s.depositBtnText}>Deposit to Gateway</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.depositForm}>
                <Text style={s.depositLabel}>Amount (USDC)</Text>
                <View style={s.depositRow}>
                  {['1', '5', '10'].map((amt) => (
                    <TouchableOpacity
                      key={amt}
                      style={[s.depositAmountBtn, depositAmount === amt && s.depositAmountActive]}
                      onPress={() => setDepositAmount(amt)}
                    >
                      <Text style={[s.depositAmountText, depositAmount === amt && s.depositAmountTextActive]}>${amt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[s.depositConfirmBtn, depositing && { opacity: 0.5 }]}
                  disabled={depositing}
                  onPress={async () => {
                    setDepositing(true);
                    setDepositStatus('Sending USDC to Gateway...');
                    try {
                      const { payForQuestion } = await import('@/lib/payment');
                      // Send USDC from Dynamic wallet to pool wallet
                      const wallets = dynamicClient.wallets?.userWallets;
                      if (!wallets?.length) {
                        setDepositStatus('No wallet connected');
                        setDepositing(false);
                        return;
                      }
                      const wallet = wallets[0];
                      const { encodeFunctionData, parseUnits } = await import('viem');
                      const walletClient = await dynamicClient.viem.createWalletClient({ wallet });
                      const poolWallet = process.env.EXPO_PUBLIC_POOL_WALLET;
                      if (!poolWallet) {
                        setDepositStatus('Pool wallet not configured');
                        setDepositing(false);
                        return;
                      }
                      const USDC = '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88';
                      const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
                      const amount = parseUnits(depositAmount, 6);

                      // Step 1: Check allowance, approve if needed
                      setDepositStatus('Checking approval...');
                      const { createPublicClient: createPC, http: httpT } = await import('viem');
                      const pc = createPC({
                        chain: { id: 4801, name: 'World Chain Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-sepolia.g.alchemy.com/v2/aIjBlwgkuTtigyA192G1h'] } } },
                        transport: httpT(),
                      });
                      const allowance = await pc.readContract({
                        address: USDC,
                        abi: [{ name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' }],
                        functionName: 'allowance',
                        args: [wallet.address, GATEWAY_WALLET],
                      });

                      if (BigInt(allowance as any) < amount) {
                        setDepositStatus('Step 1/2: Approving USDC...');
                        const approveData = encodeFunctionData({
                          abi: [{
                            name: 'approve',
                            type: 'function',
                            inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
                            outputs: [{ name: '', type: 'bool' }],
                          }],
                          functionName: 'approve',
                          args: [GATEWAY_WALLET, parseUnits('1000000', 6)], // approve max so they don't need to re-approve
                        });
                        await walletClient.sendTransaction({
                          to: USDC,
                          data: approveData,
                          value: BigInt(0),
                        });
                      }

                      // Step 2: Deposit into Gateway (token, value)
                      setDepositStatus('Step 2/2: Depositing to Gateway...');
                      const depositData = encodeFunctionData({
                        abi: [{
                          name: 'deposit',
                          type: 'function',
                          inputs: [
                            { name: 'token', type: 'address' },
                            { name: 'value', type: 'uint256' },
                          ],
                          outputs: [],
                        }],
                        functionName: 'deposit',
                        args: [USDC, amount],
                      });
                      const txHash = await walletClient.sendTransaction({
                        to: GATEWAY_WALLET,
                        data: depositData,
                        value: BigInt(0),
                      });
                      setDepositStatus(`Deposited $${depositAmount}! TX: ${(txHash as string).slice(0, 16)}...`);
                      // Refresh balance
                      const { getUSDCBalance } = await import('@/lib/payment');
                      const newBal = await getUSDCBalance();
                      setUsdcBalance(newBal);
                    } catch (err: any) {
                      setDepositStatus(`Error: ${err.message}`);
                    }
                    setDepositing(false);
                    setTimeout(() => setShowDeposit(false), 3000);
                  }}
                >
                  <Text style={s.depositConfirmText}>{depositing ? 'Sending...' : `Deposit $${depositAmount} USDC`}</Text>
                </TouchableOpacity>
                {depositStatus ? <Text style={s.depositStatusText}>{depositStatus}</Text> : null}
                <TouchableOpacity onPress={() => { setShowDeposit(false); setDepositStatus(''); }}>
                  <Text style={s.depositCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={s.disconnectBtn}
              onPress={async () => {
                try {
                  await dynamicClient.auth.logout();
                  console.log('[Profile] Wallet disconnected');
                } catch (err) {
                  console.log('[Profile] Disconnect error:', err);
                }
              }}
            >
              <Text style={s.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={s.connectWalletBtn}
            onPress={() => showDynamicAuth()}
          >
            <Text style={s.connectWalletText}>Connect Wallet</Text>
            <Text style={s.connectWalletHint}>Required for earning & payments</Text>
          </TouchableOpacity>
        )}

        {/* ID Card */}
        <View style={s.idCard}>
          {username && (
            <View style={s.idRow}>
              <Text style={s.idLabel}>USERNAME</Text>
              <Text style={s.idValue} numberOfLines={1}>{username}</Text>
            </View>
          )}
          <View style={s.idRow}>
            <Text style={s.idLabel}>WORLD ID</Text>
            <Text style={s.idValue} numberOfLines={1}>{user.world_id_nullifier.slice(0, 16)}...</Text>
          </View>
          {walletAddress && (
            <View style={s.idRow}>
              <Text style={s.idLabel}>WALLET</Text>
              <Text style={s.idValue} numberOfLines={1}>{walletAddress.slice(0, 16)}...</Text>
            </View>
          )}
          {placeName ? (
            <View style={s.idRow}>
              <Text style={s.idLabel}>LOCATION</Text>
              <Text style={s.idValue} numberOfLines={1} ellipsizeMode="tail">{placeName}</Text>
            </View>
          ) : null}
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          {[
            { icon: '💰', value: `$${user.total_earned_usdc.toFixed(2)}`, label: 'Earned' },
            { icon: '💬', value: `${user.total_queries_answered}`, label: 'Answered' },
            { icon: '⭐', value: `${user.reputation_score.toFixed(1)}`, label: 'Rep' },
          ].map((stat) => (
            <View key={stat.label} style={s.statBox}>
              <Text style={s.statIcon}>{stat.icon}</Text>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.statsRow}>
          {[
            { icon: '📍', value: `${sessionCount}`, label: 'Sessions' },
            { icon: '❓', value: `${queryCount}`, label: 'Asked' },
            { icon: '⚡', value: user.total_queries_answered > 0 ? '~12s' : '—', label: 'Speed' },
          ].map((stat) => (
            <View key={stat.label} style={s.statBox}>
              <Text style={s.statIcon}>{stat.icon}</Text>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Reputation bar */}
        <View style={s.repSection}>
          <Text style={s.sectionLabel}>REPUTATION</Text>
          <View style={s.repBar}>
            <View style={[s.repFill, { width: `${(user.reputation_score / 5) * 100}%` }]} />
          </View>
          <View style={s.repLabels}>
            <Text style={s.repLabelText}>0</Text>
            <Text style={s.repLabelText}>{user.reputation_score.toFixed(1)} / 5.0</Text>
            <Text style={s.repLabelText}>5</Text>
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={s.version}>Horacle v1.0 · ETHGlobal Cannes 2026</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scroll: { padding: 20, paddingTop: 52, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(167,139,250,0.1)', borderWidth: 2, borderColor: 'rgba(167,139,250,0.25)',
    marginBottom: 12,
  },
  avatarImg: {
    width: 80, height: 80, borderRadius: 40, marginBottom: 12,
    borderWidth: 2, borderColor: 'rgba(167,139,250,0.25)',
  },
  avatarText: { fontSize: 36 },
  displayName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  nameHint: { color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center', marginTop: 4 },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', paddingHorizontal: 20 },
  nameInput: {
    flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', paddingVertical: 8, paddingHorizontal: 12,
    borderBottomWidth: 2, borderBottomColor: '#a78bfa', textAlign: 'center',
  },
  nameSaveBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#7c3aed' },
  nameSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  verifiedBadge: {
    marginTop: 8, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
    backgroundColor: 'rgba(167,139,250,0.1)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.2)',
  },
  verifiedText: { color: '#a78bfa', fontSize: 12, fontWeight: '600' },

  walletCard: {
    padding: 16, borderRadius: 14, marginBottom: 16,
    backgroundColor: 'rgba(167,139,250,0.06)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.2)',
  },
  walletHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  walletLabel: { fontSize: 10, color: 'rgba(167,139,250,0.6)', letterSpacing: 1.5, fontFamily: 'SpaceMono' },
  walletDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#a78bfa' },
  walletCopyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  walletAddress: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: 'SpaceMono', flex: 1 },
  copyIcon: { fontSize: 14 },
  walletBalance: { fontSize: 18, color: '#a78bfa', fontWeight: '800', fontFamily: 'SpaceMono', marginBottom: 2 },
  gatewayBalance: { fontSize: 12, color: 'rgba(167,139,250,0.5)', fontFamily: 'SpaceMono', marginBottom: 8 },
  depositBtn: {
    paddingVertical: 10, borderRadius: 10, alignItems: 'center', marginBottom: 10,
    backgroundColor: 'rgba(167,139,250,0.12)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.25)',
  },
  depositBtnText: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  depositForm: { marginBottom: 10, gap: 10 },
  depositLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  depositRow: { flexDirection: 'row', gap: 8 },
  depositAmountBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  depositAmountActive: { backgroundColor: 'rgba(167,139,250,0.15)', borderColor: 'rgba(167,139,250,0.3)' },
  depositAmountText: { color: 'rgba(255,255,255,0.3)', fontSize: 15, fontWeight: '700' },
  depositAmountTextActive: { color: '#a78bfa' },
  depositConfirmBtn: {
    paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#7c3aed',
  },
  depositConfirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  depositStatusText: { color: 'rgba(167,139,250,0.6)', fontSize: 11, fontFamily: 'SpaceMono', textAlign: 'center' },
  depositCancelText: { color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center' },

  disconnectBtn: { alignSelf: 'flex-start' },
  disconnectText: { color: 'rgba(255,100,100,0.6)', fontSize: 12 },
  connectWalletBtn: {
    padding: 20, borderRadius: 14, marginBottom: 16, alignItems: 'center',
    borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.25)', borderStyle: 'dashed',
    backgroundColor: 'rgba(167,139,250,0.04)',
  },
  connectWalletText: { color: '#a78bfa', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  connectWalletHint: { color: 'rgba(255,255,255,0.2)', fontSize: 12 },

  idCard: {
    padding: 16, borderRadius: 14, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  idRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  idLabel: { fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.5, fontFamily: 'SpaceMono', width: 80 },
  idValue: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'SpaceMono', flex: 1, textAlign: 'right' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statBox: {
    flex: 1, padding: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  statIcon: { fontSize: 18, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: '800', color: '#fff', fontFamily: 'SpaceMono' },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 3, letterSpacing: 1 },

  repSection: { marginTop: 10, marginBottom: 24 },
  sectionLabel: { fontSize: 10, color: 'rgba(255,255,255,0.2)', letterSpacing: 2, fontFamily: 'SpaceMono', marginBottom: 10 },
  repBar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  repFill: { height: '100%', borderRadius: 4, backgroundColor: '#a78bfa' },
  repLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  repLabelText: { fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'SpaceMono' },

  signOutBtn: {
    alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,60,60,0.25)', backgroundColor: 'rgba(255,60,60,0.06)',
    marginBottom: 20,
  },
  signOutText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
  version: { color: 'rgba(255,255,255,0.1)', fontSize: 10, fontFamily: 'SpaceMono', textAlign: 'center' },
});
