import * as Linking from 'expo-linking';
import { gcm } from '@noble/ciphers/aes';

// Use our polyfilled crypto.getRandomValues (from react-native-get-random-values in _layout.tsx)
function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

const BRIDGE_URL = 'https://bridge.worldcoin.org';

export interface WorldIDProof {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level?: string;
  credential_type?: string;
}

export interface VerifyResult {
  success: boolean;
  proof?: WorldIDProof;
  error?: string;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

/**
 * Full World ID verification flow using pure JS crypto (no WebCrypto needed).
 * Uses @noble/ciphers for AES-GCM encryption.
 */
export async function verifyWithWorldID(
  appId: string,
  action: string = 'register'
): Promise<VerifyResult> {
  try {
    // 1. Generate 256-bit AES key
    const key = randomBytes(32);
    const exportedKey = toBase64(key);

    // 2. Encrypt the request payload
    const iv = randomBytes(12);
    const plaintext = new TextEncoder().encode(JSON.stringify({
      app_id: appId,
      action,
      signal: '',
      credential_types: ['orb'],
      verification_level: 'orb',
    }));

    const aes = gcm(key, iv);
    const ciphertext = aes.encrypt(plaintext);

    // 3. Create bridge session
    const sessionRes = await fetch(`${BRIDGE_URL}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        iv: toBase64(iv),
        payload: toBase64(ciphertext),
      }),
    });

    if (!sessionRes.ok) {
      const text = await sessionRes.text();
      return { success: false, error: `Bridge error ${sessionRes.status}: ${text}` };
    }

    const { request_id } = await sessionRes.json();

    // 4. Open World App via deep link with return URL
    const returnUrl = Linking.createURL('/');
    const verifyUrl = `https://world.org/verify?t=wld&i=${request_id}&k=${encodeURIComponent(exportedKey)}&return_to=${encodeURIComponent(returnUrl)}`;
    await Linking.openURL(verifyUrl);

    // 5. Poll for result (max 2 minutes, every 3 seconds)
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));

      try {
        const pollRes = await fetch(`${BRIDGE_URL}/response/${request_id}`);
        if (!pollRes.ok) continue;

        const pollData = await pollRes.json();

        if (pollData.status === 'completed' && pollData.response) {
          // Decrypt the response
          const respIv = fromBase64(pollData.response.iv);
          const respCiphertext = fromBase64(pollData.response.payload);

          const decryptAes = gcm(key, respIv);
          const decrypted = decryptAes.decrypt(respCiphertext);
          const proof = JSON.parse(new TextDecoder().decode(decrypted));

          // Log ALL fields to see if wallet address is included
          console.log('[WorldID] Full bridge response keys:', Object.keys(proof));
          console.log('[WorldID] Full bridge response:', JSON.stringify(proof));

          if (proof.error_code) {
            return { success: false, error: proof.error_code };
          }

          return { success: true, proof };
        }

        // Still waiting
        if (pollData.status === 'initialized' || pollData.status === 'retrieved') {
          continue;
        }
      } catch {
        // Network error on poll — retry
        continue;
      }
    }

    return { success: false, error: 'Verification timed out (2 min)' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Verify proof with World's backend API
 */
export async function verifyProofOnBackend(
  appId: string,
  action: string,
  proof: WorldIDProof,
  rpId?: string
): Promise<{ success: boolean; nullifier_hash?: string; error?: string }> {
  try {
    console.log('[WorldID] Proof received:', JSON.stringify(proof, null, 2));

    // World ID 4.0 uses rp_id, legacy uses app_id
    const effectiveRpId = rpId || process.env.EXPO_PUBLIC_RP_ID;

    // Try World ID 4.0 endpoint first (with rp_id), then legacy v2 (with app_id)
    const attempts = [
      ...(effectiveRpId ? [{
        url: `https://developer.world.org/api/v4/verify/${effectiveRpId}`,
        body: {
          protocol_version: '3.0',
          nonce: proof.nullifier_hash, // use nullifier as nonce
          action,
          environment: 'production',
          responses: [
            {
              identifier: proof.credential_type || 'orb',
              merkle_root: proof.merkle_root,
              nullifier: proof.nullifier_hash,
              proof: proof.proof,
              signal_hash: '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4',
            },
          ],
        },
      }] : []),
      {
        url: `https://developer.worldcoin.org/api/v2/verify/${appId}`,
        body: {
          merkle_root: proof.merkle_root,
          nullifier_hash: proof.nullifier_hash,
          proof: proof.proof,
          verification_level: proof.verification_level || 'orb',
          action,
          signal: '',
        },
      },
    ];

    for (const attempt of attempts) {
      console.log('[WorldID] Trying:', attempt.url);
      console.log('[WorldID] Body:', JSON.stringify(attempt.body));

      try {
        const res = await fetch(attempt.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt.body),
        });
        const data = await res.json();
        console.log('[WorldID] Response:', JSON.stringify(data));

        if (data.success) {
          const nullifier = data.nullifier || data.nullifier_hash ||
            data.results?.[0]?.nullifier || proof.nullifier_hash;
          return { success: true, nullifier_hash: nullifier };
        }
      } catch (e: any) {
        console.log('[WorldID] Fetch error for', attempt.url, ':', e.message);
        continue;
      }
    }

    return { success: false, error: 'Verification failed on all endpoints' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
