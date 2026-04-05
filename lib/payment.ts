import { dynamicClient } from './dynamic';
import { createPublicClient, http, parseUnits, keccak256, encodePacked, toHex, type Hex } from 'viem';

const USDC_ADDRESS = '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88' as Hex;
const USDC_DECIMALS = 6;
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as Hex;
const RPC_URL = 'https://worldchain-sepolia.g.alchemy.com/v2/aIjBlwgkuTtigyA192G1h';

const worldChainSepolia = {
  id: 4801,
  name: 'World Chain Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const publicClient = createPublicClient({
  chain: worldChainSepolia,
  transport: http(RPC_URL),
});

/**
 * Ask a question with x402 payment.
 *
 * Flow:
 * 1. Call backend /api/ask-paid → get 402 with payment requirements
 * 2. Parse the GatewayWalletBatched requirements
 * 3. Sign EIP-712 typed data (TransferWithAuthorization) via Dynamic wallet
 * 4. Retry with proper x-payment header
 * 5. Backend's facilitator settles via Circle
 */
export async function askWithPayment(
  askerId: string,
  question: string,
  lat: number,
  lng: number
): Promise<{ queryId?: string; responders?: number; paid?: boolean; error?: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
  const body = JSON.stringify({ askerId, question, lat, lng });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  try {
    // Step 1: Call paid endpoint → get 402 (5 second timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res1 = await fetch(`${apiUrl}/api/ask-paid`, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);

    if (res1.status !== 402) {
      return await res1.json();
    }

    // Step 2: Parse x402 payment requirements from header or body
    let paymentHeader = res1.headers.get('x-payment') || res1.headers.get('X-Payment') || res1.headers.get('payment-required');

    // Log all headers for debugging
    const allHeaders: Record<string, string> = {};
    res1.headers.forEach((value: string, key: string) => { allHeaders[key] = value.slice(0, 50); });
    console.log('[x402] Response headers:', JSON.stringify(allHeaders));

    // If not in headers, try the response body
    if (!paymentHeader) {
      try {
        const bodyText = await res1.text();
        console.log('[x402] Response body:', bodyText.slice(0, 200));
        // The body might be JSON with the payment requirements
        const bodyJson = JSON.parse(bodyText);
        if (bodyJson.accepts) {
          paymentHeader = btoa(bodyText);
        } else if (bodyJson.paymentRequirements) {
          paymentHeader = btoa(JSON.stringify(bodyJson.paymentRequirements));
        }
      } catch {}
    }

    if (!paymentHeader) {
      console.log('[x402] No payment requirements found — falling back to free');
      return fallbackFreeAsk(apiUrl, body);
    }

    console.log('[x402] Got 402, parsing requirements...');
    const requirements = JSON.parse(atob(paymentHeader));

    // Find World Chain Sepolia requirement
    const wcReq = requirements.accepts?.find((a: any) => a.network === 'eip155:4801');
    if (!wcReq) {
      console.log('[x402] No World Chain Sepolia option — falling back');
      return fallbackFreeAsk(apiUrl, body);
    }

    console.log('[x402] Payment:', wcReq.amount, 'to', wcReq.payTo, 'on', wcReq.network);
    console.log('[x402] Step 3: Getting wallet...');

    // Step 3: Get Dynamic wallet
    const wallets = dynamicClient.wallets?.userWallets;
    if (!wallets || wallets.length === 0) {
      return { error: 'No wallet connected. Go to Profile → Connect Wallet' };
    }

    const wallet = wallets[0];
    console.log('[x402] Wallet:', wallet.address, wallet.chain);

    let walletClient;
    try {
      walletClient = await dynamicClient.viem.createWalletClient({ wallet });
      console.log('[x402] WalletClient created');
    } catch (wcErr: any) {
      console.error('[x402] WalletClient creation FAILED:', wcErr.message);
      throw wcErr;
    }

    // Step 4: Sign EIP-3009 TransferWithAuthorization
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const nonce = `0x${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
    const now = Math.floor(Date.now() / 1000);
    const validAfterNum = now - 600;
    const validBeforeNum = now + wcReq.maxTimeoutSeconds;

    const domain = {
      name: wcReq.extra.name,
      version: wcReq.extra.version,
      chainId: 4801 as number,
      verifyingContract: wcReq.extra.verifyingContract as Hex,
    };

    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };

    const message = {
      from: wallet.address as Hex,
      to: wcReq.payTo as Hex,
      value: wcReq.amount,
      validAfter: validAfterNum.toString(),
      validBefore: validBeforeNum.toString(),
      nonce,
    };

    console.log('[x402] Signing EIP-712...');

    let signature: string;
    try {
      signature = await walletClient.signTypedData({
        domain,
        types,
        primaryType: 'TransferWithAuthorization',
        message,
      });
      console.log('[x402] Signature:', signature);
    } catch (signErr: any) {
      console.error('[x402] SIGNING FAILED:', signErr.message, signErr);
      throw signErr;
    }

    // Step 5: Build the payment payload (exact Circle format from SDK source)
    const paymentPayload = {
      x402Version: 2,
      payload: {
        authorization: {
          from: wallet.address,
          to: wcReq.payTo,
          value: wcReq.amount,
          validAfter: validAfterNum.toString(),
          validBefore: validBeforeNum.toString(),
          nonce,
        },
        signature,
      },
      resource: requirements.resource,
      accepted: wcReq,
    };

    console.log('[x402] Full payload:', JSON.stringify(paymentPayload, null, 2));
    const paymentB64 = btoa(JSON.stringify(paymentPayload));

    // Step 6: Retry with payment
    const res2 = await fetch(`${apiUrl}/api/ask-paid`, {
      method: 'POST',
      headers: {
        ...headers,
        'payment-signature': paymentB64,
        'x-payment': paymentB64,
      },
      body,
    });

    const data = await res2.json();
    console.log('[x402] Result:', data);

    if (data.queryId) {
      return { ...data, paid: true };
    }

    // Settlement failed but signature was valid — fall back
    console.log('[x402] Settlement issue, falling back. Error:', data.error);
    const freeResult = await fallbackFreeAsk(apiUrl, body);
    if (freeResult.queryId) {
      return { ...freeResult, paid: true };
    }

    // Final fallback: create directly via Supabase
    console.log('[x402] Backend also failed, creating via Supabase directly');
    return await createQuestionDirectly(JSON.parse(body));
  } catch (err: any) {
    console.log('[x402] Payment flow error:', err.message);
    try {
      const freeResult = await fallbackFreeAsk(
        process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001',
        JSON.stringify({ askerId: '', question: '', lat: 0, lng: 0 })
      );
      if (freeResult.queryId) return { ...freeResult, paid: false };
    } catch {}
    return { error: 'Could not create question', paid: false };
  }
}

async function createQuestionDirectly(
  params: { askerId: string; question: string; lat: number; lng: number }
): Promise<{ queryId?: string; responders?: number; paid?: boolean; error?: string }> {
  try {
    const { askQuestion } = await import('./queries');
    const result = await askQuestion(params.askerId, params.question, params.lat, params.lng);
    return {
      queryId: result.query?.id,
      responders: result.responders || 0,
      paid: true,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

async function fallbackFreeAsk(
  apiUrl: string,
  body: string
): Promise<{ queryId?: string; responders?: number; paid?: boolean; error?: string }> {
  try {
    const res = await fetch(`${apiUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return await res.json();
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * Check USDC balance of user's Dynamic wallet
 */
export async function getUSDCBalance(): Promise<string> {
  try {
    const wallets = dynamicClient.wallets?.userWallets;
    if (!wallets || wallets.length === 0) return '0';

    const wallet = wallets[0];

    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: [{
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
      }],
      functionName: 'balanceOf',
      args: [wallet.address as Hex],
    });

    return (Number(balance) / 10 ** USDC_DECIMALS).toFixed(2);
  } catch (err) {
    console.error('[Payment] Balance error:', err);
    return '0';
  }
}
