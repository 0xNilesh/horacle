import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

console.log('=== Horacle Wallet Generator ===\n');

const touristKey = generatePrivateKey();
const touristAccount = privateKeyToAccount(touristKey);
console.log('Asker Agent Wallet (server-side, auto-signs x402):');
console.log(`  Address:     ${touristAccount.address}`);
console.log(`  Private Key: ${touristKey}`);
console.log('');
console.log('Add to your backend .env:');
console.log(`ASKER_AGENT_PRIVATE_KEY=${touristKey}`);
console.log('');
console.log('Next steps:');
console.log('1. Get testnet USDC from faucet.circle.com for:', touristAccount.address);
console.log('2. Responder wallets come from World App — no key storage needed');
