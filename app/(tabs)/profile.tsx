import { StyleSheet, TouchableOpacity, ScrollView, Share, TextInput } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { reverseGeocode } from '@/lib/geocode';
import { getCurrentLocation } from '@/lib/location';
import { useDynamic, showDynamicAuth, dynamicClient } from '@/lib/dynamic';
import { saveWalletAddress } from '@/lib/wallet';
import { getUSDCBalance } from '@/lib/payment';
import { router } from 'expo-router';
import { encodeFunctionData, parseUnits } from 'viem';

export default function ProfileScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [queryCount, setQueryCount] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [gatewayBalance, setGatewayBalance] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [depositAmount, setDepositAmount] = useState('1');
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositStatus, setDepositStatus] = useState('');

  const dynamicState = useDynamic();
  const connectedWallets = dynamicState?.wallets?.userWallets || [];
  const primaryWallet = dynamicState?.wallets?.primary;
  const walletAddress = primaryWallet?.address || connectedWallets?.[0]?.address;

  useEffect(() => { loadProfile(); }, []);
  useEffect(() => {
    if (walletAddress && user) { saveWalletAddress(walletAddress); }
  }, [walletAddress, user]);
  useEffect(() => {
    if (walletAddress) getUSDCBalance().then(setUsdcBalance);
    if (dynamicState?.auth?.token && !walletAddress) {
      dynamicState.wallets?.embedded?.createWallet?.({ chain: 'Evm' }).catch(() => {});
    }
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
    fetch(`${apiUrl}/api/balance`).then(r => r.json()).then(d => { if (d.gateway && d.gateway !== '0') setGatewayBalance(d.gateway); }).catch(() => {});
  }, [walletAddress]);

  const loadProfile = async () => {
    const u = await getUser();
    setUser(u);
    if (!u) return;
    const loc = await getCurrentLocation();
    if (loc) reverseGeocode(loc.lat, loc.lng).then(setPlaceName);
    const { data: fresh } = await supabase.from('users').select('*').eq('id', u.id).single();
    if (fresh) setUser({ ...u, reputation_score: fresh.reputation_score, total_earned_usdc: fresh.total_earned_usdc, total_queries_answered: fresh.total_queries_answered });
    const { count: sessions } = await supabase.from('live_sessions').select('id', { count: 'exact', head: true }).eq('user_id', u.id);
    setSessionCount(sessions || 0);
    const { count: queries } = await supabase.from('queries').select('id', { count: 'exact', head: true }).eq('asker_id', u.id);
    setQueryCount(queries || 0);
  };

  if (!user) return null;

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={s.avatar}><Text style={s.avatarText}>H</Text></View>
          <Text style={s.displayName}>Verified Human</Text>
          <View style={s.verifiedBadge}><Text style={s.verifiedText}>World ID Verified</Text></View>
        </View>

        {/* Wallet */}
        {walletAddress ? (
          <View style={s.walletCard}>
            <View style={s.walletHeader}>
              <Text style={s.walletLabel}>Wallet</Text>
              <View style={s.walletDot} />
            </View>
            <TouchableOpacity style={s.walletCopyRow} onPress={() => Share.share({ message: walletAddress })}>
              <Text style={s.walletAddress} numberOfLines={1}>{walletAddress}</Text>
              <Text style={s.copyIcon}>Copy</Text>
            </TouchableOpacity>
            <Text style={s.walletBalance}>{usdcBalance} USDC</Text>
            {gatewayBalance ? <Text style={s.gatewayBal}>Gateway: {gatewayBalance} USDC</Text> : null}

            {!showDeposit ? (
              <TouchableOpacity style={s.depositBtn} onPress={() => setShowDeposit(true)}>
                <Text style={s.depositBtnText}>Deposit to Gateway</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.depositForm}>
                <View style={s.depositRow}>
                  {['1', '5', '10'].map((amt) => (
                    <TouchableOpacity key={amt} style={[s.depositAmtBtn, depositAmount === amt && s.depositAmtActive]} onPress={() => setDepositAmount(amt)}>
                      <Text style={[s.depositAmtText, depositAmount === amt && s.depositAmtTextActive]}>${amt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={[s.depositConfirm, depositing && { opacity: 0.5 }]} disabled={depositing}
                  onPress={async () => {
                    setDepositing(true); setDepositStatus('Depositing...');
                    try {
                      const wallet = connectedWallets[0];
                      const walletClient = await dynamicClient.viem.createWalletClient({ wallet });
                      const USDC = '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88';
                      const GATEWAY = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
                      const amount = parseUnits(depositAmount, 6);
                      const { createPublicClient: createPC, http: httpT } = await import('viem');
                      const pc = createPC({ chain: { id: 4801, name: 'WCS', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-sepolia.g.alchemy.com/v2/aIjBlwgkuTtigyA192G1h'] } } }, transport: httpT() });
                      const allowance = await pc.readContract({ address: USDC, abi: [{ name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' }], functionName: 'allowance', args: [wallet.address, GATEWAY] });
                      if (BigInt(allowance as any) < amount) {
                        setDepositStatus('Approving...');
                        await walletClient.sendTransaction({ to: USDC, data: encodeFunctionData({ abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }], functionName: 'approve', args: [GATEWAY, parseUnits('1000000', 6)] }), value: BigInt(0) });
                      }
                      setDepositStatus('Depositing...');
                      await walletClient.sendTransaction({ to: GATEWAY, data: encodeFunctionData({ abi: [{ name: 'deposit', type: 'function', inputs: [{ name: 'token', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [] }], functionName: 'deposit', args: [USDC, amount] }), value: BigInt(0) });
                      setDepositStatus(`Deposited $${depositAmount}`);
                      getUSDCBalance().then(setUsdcBalance);
                    } catch (err: any) { setDepositStatus(err.message?.slice(0, 50)); }
                    setDepositing(false); setTimeout(() => setShowDeposit(false), 2000);
                  }}>
                  <Text style={s.depositConfirmText}>{depositing ? 'Processing...' : `Deposit $${depositAmount}`}</Text>
                </TouchableOpacity>
                {depositStatus ? <Text style={s.depositStatusText}>{depositStatus}</Text> : null}
                <TouchableOpacity onPress={() => { setShowDeposit(false); setDepositStatus(''); }}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={s.disconnectBtn} onPress={async () => { try { await dynamicClient.auth.logout(); } catch {} }}>
              <Text style={s.disconnectText}>Disconnect wallet</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={s.connectBtn} onPress={() => showDynamicAuth()}>
            <Text style={s.connectBtnText}>Connect Wallet</Text>
            <Text style={s.connectBtnSub}>Required for earning and payments</Text>
          </TouchableOpacity>
        )}

        {/* ID Card */}
        <View style={s.idCard}>
          <View style={s.idRow}><Text style={s.idLabel}>World ID</Text><Text style={s.idValue} numberOfLines={1}>{user.world_id_nullifier.slice(0, 16)}...</Text></View>
          {walletAddress && <View style={s.idRow}><Text style={s.idLabel}>Wallet</Text><Text style={s.idValue} numberOfLines={1}>{walletAddress.slice(0, 16)}...</Text></View>}
          {placeName ? <View style={s.idRow}><Text style={s.idLabel}>Location</Text><Text style={s.idValue} numberOfLines={1}>{placeName}</Text></View> : null}
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          {[
            { label: 'Earned', value: `$${user.total_earned_usdc.toFixed(2)}` },
            { label: 'Answered', value: `${user.total_queries_answered}` },
            { label: 'Rep', value: `${user.reputation_score.toFixed(1)}` },
          ].map(st => (
            <View key={st.label} style={s.statBox}>
              <Text style={s.statValue}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>
        <View style={s.statsRow}>
          {[
            { label: 'Sessions', value: `${sessionCount}` },
            { label: 'Asked', value: `${queryCount}` },
            { label: 'Speed', value: user.total_queries_answered > 0 ? '~12s' : '—' },
          ].map(st => (
            <View key={st.label} style={s.statBox}>
              <Text style={s.statValue}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* Reputation */}
        <View style={s.repSection}>
          <Text style={s.repTitle}>Reputation</Text>
          <View style={s.repBar}><View style={[s.repFill, { width: `${(user.reputation_score / 5) * 100}%` }]} /></View>
          <View style={s.repLabels}><Text style={s.repLabel}>0</Text><Text style={s.repLabel}>{user.reputation_score.toFixed(1)} / 5.0</Text><Text style={s.repLabel}>5</Text></View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={async () => { await clearUser(); router.replace('/(auth)/verify'); }}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>
        <Text style={s.version}>Horacle v1.0</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { padding: 20, paddingTop: 52, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F5F5F7', borderWidth: 2, borderColor: '#E8E8EC', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#1A1A1E' },
  displayName: { color: '#1A1A1E', fontSize: 20, fontWeight: '700' },
  verifiedBadge: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16, backgroundColor: '#F0FAF3', borderWidth: 1, borderColor: '#C8E6D0' },
  verifiedText: { color: '#34C759', fontSize: 11, fontWeight: '600' },

  walletCard: { padding: 16, borderRadius: 14, marginBottom: 16, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  walletHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  walletLabel: { fontSize: 11, color: '#A0A0AB', letterSpacing: 1 },
  walletDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' },
  walletCopyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  walletAddress: { fontSize: 12, color: '#6B6B76', fontFamily: 'SpaceMono', flex: 1 },
  copyIcon: { color: '#A0A0AB', fontSize: 11 },
  walletBalance: { fontSize: 20, color: '#1A1A1E', fontWeight: '700', fontFamily: 'SpaceMono', marginBottom: 2 },
  gatewayBal: { fontSize: 12, color: '#A0A0AB', fontFamily: 'SpaceMono', marginBottom: 10 },

  depositBtn: { paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8EC', marginBottom: 10 },
  depositBtnText: { color: '#1A1A1E', fontSize: 13, fontWeight: '600' },
  depositForm: { gap: 8, marginBottom: 10 },
  depositRow: { flexDirection: 'row', gap: 8 },
  depositAmtBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8EC' },
  depositAmtActive: { backgroundColor: '#7C5CFC', borderColor: '#1A1A1E' },
  depositAmtText: { color: '#6B6B76', fontSize: 15, fontWeight: '700' },
  depositAmtTextActive: { color: '#FFFFFF' },
  depositConfirm: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#7C5CFC' },
  depositConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  depositStatusText: { color: '#A0A0AB', fontSize: 11, textAlign: 'center' },
  cancelText: { color: '#A0A0AB', fontSize: 12, textAlign: 'center' },

  disconnectBtn: { alignSelf: 'flex-start' },
  disconnectText: { color: '#FF3B30', fontSize: 12 },

  connectBtn: { padding: 20, borderRadius: 14, marginBottom: 16, alignItems: 'center', borderWidth: 1.5, borderColor: '#E8E8EC', borderStyle: 'dashed' },
  connectBtnText: { color: '#1A1A1E', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  connectBtnSub: { color: '#A0A0AB', fontSize: 12 },

  idCard: { padding: 16, borderRadius: 14, marginBottom: 16, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  idRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  idLabel: { fontSize: 11, color: '#A0A0AB', letterSpacing: 1, width: 70 },
  idValue: { fontSize: 12, color: '#6B6B76', fontFamily: 'SpaceMono', flex: 1, textAlign: 'right' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statBox: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1A1A1E', fontFamily: 'SpaceMono' },
  statLabel: { fontSize: 9, color: '#A0A0AB', marginTop: 3, letterSpacing: 1 },

  repSection: { marginTop: 6, marginBottom: 20 },
  repTitle: { fontSize: 13, color: '#6B6B76', fontWeight: '600', marginBottom: 8 },
  repBar: { height: 6, borderRadius: 3, backgroundColor: '#EEEDF5', overflow: 'hidden' },
  repFill: { height: '100%', borderRadius: 3, backgroundColor: '#7C5CFC' },
  repLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  repLabel: { fontSize: 10, color: '#A0A0AB', fontFamily: 'SpaceMono' },

  signOutBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, borderWidth: 1, borderColor: '#FFD0CD', backgroundColor: '#FFF5F4', marginBottom: 16 },
  signOutText: { color: '#FF3B30', fontSize: 14, fontWeight: '600' },
  version: { color: '#D0D0D8', fontSize: 11, textAlign: 'center' },
});
