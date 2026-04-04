import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { GatewayClient } from '@circle-fin/x402-batching/client';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, parseAbi } from 'viem';

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONFIG
// ============================================
const POOL_PRIVATE_KEY = process.env.POOL_PRIVATE_KEY;
const POOL_ADDRESS = POOL_PRIVATE_KEY
  ? privateKeyToAccount(POOL_PRIVATE_KEY).address
  : null;

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Circle Gateway client for pool wallet (handles deposits + withdrawals)
let gatewayClient = null;
if (POOL_PRIVATE_KEY) {
  try {
    gatewayClient = new GatewayClient({
      chain: 'worldChainSepolia',
      privateKey: POOL_PRIVATE_KEY,
    });
    console.log('[Circle] Gateway client ready, pool:', POOL_ADDRESS);
  } catch (err) {
    console.error('[Circle] Init failed:', err.message);
  }
}

// x402 payment middleware — protects endpoints, requires nanopayment
const gateway = POOL_ADDRESS
  ? createGatewayMiddleware({ sellerAddress: POOL_ADDRESS })
  : null;

// ============================================
// HEALTH
// ============================================
app.get('/health', async (req, res) => {
  let gatewayBalance = null;
  if (gatewayClient) {
    try {
      const b = await gatewayClient.getBalances();
      gatewayBalance = {
        wallet: b.wallet?.formattedAvailable || '0',
        gateway: b.gateway?.formattedAvailable || '0',
      };
    } catch {}
  }
  res.json({
    status: 'ok',
    pool: POOL_ADDRESS || 'NOT SET',
    gateway: gatewayBalance,
  });
});

// ============================================
// x402-PROTECTED ENDPOINT — Asker pays to ask a question
// When asker's app calls this, x402 handles the payment automatically:
//   1. Returns 402 with payment requirements
//   2. Asker's app signs EIP-3009 (Dynamic wallet, gasless)
//   3. Asker retries with PAYMENT-SIGNATURE header
//   4. Middleware verifies + settles via Circle's facilitator
//   5. Pool wallet receives $0.05 USDC
//   6. Endpoint returns success
// ============================================
// Log all incoming payment headers
app.use('/api/ask-paid', (req, res, next) => {
  const paymentSig = req.headers['payment-signature'];
  if (paymentSig) {
    try {
      const decoded = JSON.parse(Buffer.from(paymentSig, 'base64').toString());
      console.log('[x402 Server] Received payment:', JSON.stringify(decoded, null, 2));
    } catch (e) {
      console.log('[x402 Server] Raw payment header:', paymentSig.slice(0, 100));
    }
  } else {
    console.log('[x402 Server] No payment-signature header (will return 402)');
  }
  next();
});

if (gateway) {
  app.post('/api/ask-paid',
    gateway.require('$0.05'),
    async (req, res) => {
      const { askerId, question, lat, lng } = req.body;
      const payer = req.payment?.payer;

      console.log(`[x402] Paid question from ${payer}: "${question}"`);

      // Create query in Supabase
      try {
        const { data: queryId, error } = await supabase.rpc('create_query', {
          p_asker_id: askerId,
          p_question: question,
          p_lng: lng,
          p_lat: lat,
          p_budget_usdc: 0.05,
          p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });

        if (error) {
          return res.status(500).json({ error: error.message });
        }

        // Find nearby responders + notify
        const { data: responders } = await supabase.rpc('find_live_responders', {
          p_lng: lng, p_lat: lat, p_radius_m: 300,
        });

        // Send push notifications
        if (responders?.length > 0) {
          const messages = responders
            .filter(r => r.push_token)
            .map(r => ({
              to: r.push_token,
              title: '💰 Quick $0.05',
              body: question.length > 80 ? question.slice(0, 77) + '...' : question,
              data: { queryId, type: 'query' },
              sound: 'default',
              priority: 'high',
            }));

          if (messages.length > 0) {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(messages),
            });
          }
        }

        res.json({
          queryId,
          responders: responders?.length || 0,
          paid: true,
          payer,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
}

// ============================================
// NON-PAID ASK (fallback if x402 not set up)
// ============================================
app.post('/api/ask', async (req, res) => {
  const { askerId, question, lat, lng } = req.body;

  try {
    const { data: queryId, error } = await supabase.rpc('create_query', {
      p_asker_id: askerId,
      p_question: question,
      p_lng: lng,
      p_lat: lat,
      p_budget_usdc: 0.05,
      p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    if (error) return res.status(500).json({ error: error.message });

    const { data: responders } = await supabase.rpc('find_live_responders', {
      p_lng: lng, p_lat: lat, p_radius_m: 300,
    });

    // Send push notifications
    if (responders?.length > 0) {
      const messages = responders
        .filter(r => r.push_token)
        .map(r => ({
          to: r.push_token,
          title: '💰 Quick $0.05',
          body: question.length > 80 ? question.slice(0, 77) + '...' : question,
          data: { queryId, type: 'query' },
          sound: 'default',
          priority: 'high',
        }));

      if (messages.length > 0) {
        console.log(`[Push] Sending to ${messages.length} responders`);
        fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages),
        }).catch(err => console.log('[Push] Error:', err.message));
      }
    }

    console.log(`[Ask Free] Query ${queryId}, ${responders?.length || 0} responders`);
    res.json({ queryId, responders: responders?.length || 0, paid: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DEPOSIT — Pool deposits USDC into Circle Gateway
// ============================================
app.post('/api/deposit', async (req, res) => {
  if (!gatewayClient) return res.status(500).json({ error: 'Gateway not set up' });

  const { amount } = req.body;
  try {
    const result = await gatewayClient.deposit(amount || '1');
    console.log('[Circle] Deposited:', result.depositTxHash);
    res.json({ success: true, txHash: result.depositTxHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BATCH SETTLE — Withdraw from Gateway to responders
// Called by daily cron
// ============================================
app.post('/api/batch-settle', async (req, res) => {
  if (!gatewayClient) return res.status(500).json({ error: 'Gateway not set up' });

  try {
    // Get all users with pending earnings
    const { data: users } = await supabase
      .from('users')
      .select('id, wallet_address, total_earned_usdc')
      .gt('total_earned_usdc', 0);

    if (!users?.length) {
      return res.json({ success: true, settled: 0, message: 'No pending earnings' });
    }

    // First deposit accumulated USDC into Gateway
    const totalPending = users.reduce((sum, u) => sum + (u.total_earned_usdc || 0), 0);

    if (totalPending > 0) {
      try {
        console.log(`[Batch] Depositing ${totalPending} USDC into Gateway`);
        await gatewayClient.deposit(totalPending.toFixed(2));
      } catch (err) {
        console.log('[Batch] Deposit error (may already be deposited):', err.message);
      }
    }

    // Withdraw to each responder
    const results = [];
    for (const user of users) {
      if (!user.wallet_address || user.total_earned_usdc <= 0) continue;
      // Skip placeholder wallets (derived from nullifier)
      if (user.wallet_address.length < 42) continue;

      try {
        console.log(`[Batch] Withdrawing ${user.total_earned_usdc} USDC to ${user.wallet_address}`);
        const result = await gatewayClient.withdraw(
          user.total_earned_usdc.toFixed(2)
        );

        // Reset earnings
        await supabase.from('users').update({ total_earned_usdc: 0 }).eq('id', user.id);

        results.push({
          userId: user.id,
          amount: user.total_earned_usdc,
          status: 'settled',
        });
      } catch (err) {
        results.push({
          userId: user.id,
          amount: user.total_earned_usdc,
          status: 'failed',
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      settled: results.filter(r => r.status === 'settled').length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BALANCE
// ============================================
app.get('/api/balance', async (req, res) => {
  if (!gatewayClient) return res.json({ pool: '0', gateway: '0' });
  try {
    const b = await gatewayClient.getBalances();
    res.json({
      pool: b.wallet?.formattedAvailable || '0',
      gateway: b.gateway?.formattedAvailable || '0',
    });
  } catch (err) {
    res.json({ pool: '0', gateway: '0', error: err.message });
  }
});

// User Gateway balance check
app.get('/api/user-balance/:address', async (req, res) => {
  try {
    const address = req.params.address;
    const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
    const USDC = '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88';

    // Check USDC balance in wallet
    const walletBal = await publicClient.readContract({
      address: USDC,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [address],
    });

    // Try to get Gateway balance via GatewayClient for pool
    // For user's own gateway balance, we'd need their GatewayClient
    // For now just show wallet USDC balance
    res.json({
      wallet: (Number(walletBal) / 1e6).toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Backend] http://localhost:${PORT}`);
  console.log(`[Backend] Pool: ${POOL_ADDRESS || 'NOT SET'}`);
  console.log(`[Backend] x402 protected: ${gateway ? 'YES' : 'NO'}`);
});
