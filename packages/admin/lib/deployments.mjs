// packages/admin/lib/deployments.mjs
//
// The one table of contract addresses the Hub prepares deployments against. Sepolia only (L7-D1, spec §3);
// every address has its source URL beside it and again in `sources`. No address literal of these contracts
// lives anywhere else. Pure: no imports.

const SAFE_DEPLOYMENTS = 'https://raw.githubusercontent.com/safe-global/safe-deployments/main/src/assets/v1.4.1'

/** MultiSendCallOnly 1.4.1, its canonical deployment: the same address on every chain the hats-tree driver reads
 *  (server/systems/chains.ts), each listed `"canonical"` in `networkAddresses` of
 *  https://github.com/safe-global/safe-deployments/blob/ca9cb0d2d5f5175fc8e41d579f356748d2bc1c62/src/assets/v1.4.1/multi_send_call_only.json
 *  (read 2026-11-06; deployments.canonical.address, codeHash 0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939).
 *  Used by add-role (OQ-1, PF-R192) to make a new hat and its first wearers one Safe transaction. */
const MULTI_SEND_CALL_ONLY_141 = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'
export const CALL_ONLY = Object.freeze({
  version: '1.4.1',
  address: MULTI_SEND_CALL_ONLY_141,
  source: 'https://github.com/safe-global/safe-deployments/blob/ca9cb0d2d5f5175fc8e41d579f356748d2bc1c62/src/assets/v1.4.1/multi_send_call_only.json',
  chains: Object.freeze(['eip155:1', 'eip155:10', 'eip155:100', 'eip155:137', 'eip155:8453', 'eip155:42161', 'eip155:42220', 'eip155:11155111']),
})

/** MultiSendCallOnly 1.4.1's address on `chain`, or null where the source above does not list it canonical.
 * @param {string} chain CAIP-2 @returns {string | null} */
export function multiSendCallOnlyOn(chain) {
  return CALL_ONLY.chains.includes(chain) ? CALL_ONLY.address : null
}

/** @typedef {{
 *   safe: { version: '1.4.1', proxyFactory: string, singletonL2: string, fallbackHandler: string, multiSend: string, multiSendCallOnly: string },
 *   hats: { version: 'v1', address: string },
 *   hsg: { version: '2.0.0', implementation: string, moduleProxyFactory: string },
 *   ens: { universalResolver: string },
 *   sources: Record<string, string> }} ChainDeployments */

/** @type {Record<string, ChainDeployments>} */
export const DEPLOYMENTS = {
  'eip155:11155111': {
    safe: {
      version: '1.4.1',
      proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67', // SafeProxyFactory, sources.safe.proxyFactory
      singletonL2: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762', // SafeL2, sources.safe.singletonL2
      fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99', // CompatibilityFallbackHandler, sources.safe.fallbackHandler
      multiSend: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526', // MultiSend, sources.safe.multiSend
      multiSendCallOnly: MULTI_SEND_CALL_ONLY_141, // MultiSendCallOnly (the one HSG v2 allows), sources.safe.multiSendCallOnly
    },
    hats: {
      version: 'v1',
      address: '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137', // Hats Protocol, sources.hats.address
    },
    hsg: {
      version: '2.0.0',
      implementation: '0x148057884AC910Bdd93693F230C5c35a8c47CA3b', // HatsSignerGate master copy, sources.hsg.implementation
      moduleProxyFactory: '0x000000000000aDdB49795b0f9bA5BC298cDda236', // Zodiac ModuleProxyFactory, sources.hsg.moduleProxyFactory
    },
    ens: {
      universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe', // ENS Universal Resolver (proxy), sources.ens.universalResolver
    },
    sources: {
      'safe.proxyFactory': `${SAFE_DEPLOYMENTS}/safe_proxy_factory.json`,
      'safe.singletonL2': `${SAFE_DEPLOYMENTS}/safe_l2.json`,
      'safe.fallbackHandler': `${SAFE_DEPLOYMENTS}/compatibility_fallback_handler.json`,
      'safe.multiSend': `${SAFE_DEPLOYMENTS}/multi_send.json`,
      'safe.multiSendCallOnly': `${SAFE_DEPLOYMENTS}/multi_send_call_only.json`,
      'hats.address': 'https://github.com/Hats-Protocol/hats-protocol/releases/tag/v1',
      'hsg.implementation': 'https://github.com/Hats-Protocol/hats-zodiac/releases/tag/v2.0.0',
      'hsg.moduleProxyFactory': 'https://raw.githubusercontent.com/Hats-Protocol/hats-zodiac/main/script/DeployParams.json (key 11155111)',
      'ens.universalResolver': 'https://docs.ens.domains/learn/deployments',
    },
  },
}

/** @param {string} chain CAIP-2 chain id @returns {ChainDeployments} */
export function deploymentsOn(chain) {
  if (!Object.hasOwn(DEPLOYMENTS, chain)) throw new Error('Deploying is built for Sepolia (eip155:11155111) only.')
  return DEPLOYMENTS[chain]
}
