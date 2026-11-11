// packages/admin/tests/lib/create2.test.ts
//
// Published vectors (no network in this test; each was read once, 2026-10-30):
// - EIP-1014 "Examples" 0, 1 and 5: https://eips.ethereum.org/EIPS/eip-1014 (source: https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1014.md)
// - A real Sepolia Safe 1.4.1 (SafeL2) created by the 1.4.1 SafeProxyFactory, public chain data:
//   tx https://eth-sepolia.blockscout.com/tx/0x8c10d1f5ab10e9d6e9a7e907e3dba38e9fa841fd938f2f202a2d50d40c76c170
//   (block 12029195): createProxyWithNonce(singleton, initializer, saltNonce) and the ProxyCreation event give the
//   proxy 0x848756e8fBFCC6BAA6D2b30179D05d9b18880600. proxyCreationCode() is the factory's answer to eth_call 0x53e5d935
//   on https://ethereum-sepolia-rpc.publicnode.com (factory source: safe-global/safe-smart-account v1.4.1
//   contracts/proxies/SafeProxyFactory.sol, https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxyFactory.sol).
// - A real Sepolia ModuleProxyFactory deployment, public chain data:
//   tx https://eth-sepolia.blockscout.com/tx/0x6d522ffd5bc0393aee38063561a193cc2794875ecd452937fd19d6a3ff366dd3
//   (block 12019848): deployModule(masterCopy, initializer, saltNonce) with the ModuleProxyCreation event naming proxy
//   0xb92E6B43A54E80898F0Dfa05259d940C177dfd55. The init code (EIP-1167 minimal proxy) is read from the factory source
//   gnosisguild/zodiac @ b7988c0e352c8e409145b76d193ba67a6f2e44d1,
//   https://github.com/gnosisguild/zodiac/blob/b7988c0e352c8e409145b76d193ba67a6f2e44d1/mastercopies/factory/1.2.0/ModuleProxyFactory/sourcecode.json
//   (createProxy: hex"602d8060093d393df3363d3d373d3d3d363d73", target, hex"5af43d82803e903d91602b57fd5bf3";
//   salt keccak256(abi.encodePacked(keccak256(initializer), saltNonce))). Task 20 pins the harness's fork run as well.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { create2Address, safeProxyAddress, zodiacModuleAddress } from '../../lib/create2.mjs'
import { keccak256 } from '../../lib/keccak.mjs'

const hex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const hashOf = (initCode: string) => hex(keccak256(Uint8Array.from(initCode.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16))))
const ZERO_SALT = '0x' + '00'.repeat(32)

describe('create2Address (EIP-1014)', () => {
  it('example 0', () => {
    expect(create2Address('0x0000000000000000000000000000000000000000', ZERO_SALT, hashOf('0x00'))).toBe('0x4D1A2e2bB4F88F0250f26Ffff098B0b30B26BF38')
  })
  it('example 1', () => {
    expect(create2Address('0xdeadbeef00000000000000000000000000000000', ZERO_SALT, hashOf('0x00'))).toBe('0xB928f69Bb1D91Cd65274e3c79d8986362984fDA3')
  })
  it('example 5', () => {
    expect(create2Address('0x00000000000000000000000000000000deadbeef', '0x00000000000000000000000000000000000000000000000000000000cafebabe',
      hashOf('0x' + 'deadbeef'.repeat(11)))).toBe('0x1d8bfDC5D46DC4f61D6b6115972536eBE6A8854C')
  })
  it('refuses a salt or hash of the wrong size and a deployer that is not an address', () => {
    expect(() => create2Address('0x00', ZERO_SALT, ZERO_SALT)).toThrow(/deployer/)
    expect(() => create2Address('0x' + '00'.repeat(20), '0x00', ZERO_SALT)).toThrow(/salt/)
    expect(() => create2Address('0x' + '00'.repeat(20), ZERO_SALT, 'nope')).toThrow(/initCodeHash/)
  })
})

describe('safeProxyAddress', () => {
  it('reproduces a real Sepolia Safe created by the 1.4.1 factory', () => {
    expect(safeProxyAddress({
      factory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
      initializer: '0xb63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec9900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000003bb655a54cc4d66aebcd8d0f71cf59c2aa15339f0000000000000000000000000000000000000000000000000000000000000000',
      saltNonce: '0xaa995cbf13b503f1c943c2edda33c3b4bb99562ea2136a61c217059555e61d79',
      proxyCreationCode: '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564',
    })).toBe('0x848756e8fBFCC6BAA6D2b30179D05d9b18880600')
  })
})

describe('zodiacModuleAddress', () => {
  it('reproduces a real Sepolia ModuleProxyFactory deployment', () => {
    expect(zodiacModuleAddress({
      factory: '0x000000000000aDdB49795b0f9bA5BC298cDda236',
      masterCopy: '0xf2964ce6161ce0e75964fe7927ce114cb0b283d5',
      initializer: '0xa4f9edbf0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000077cde26a28b4687c1b77f578e46a2cc0daf9db6000000000000000000000000077cde26a28b4687c1b77f578e46a2cc0daf9db6000000000000000000000000077cde26a28b4687c1b77f578e46a2cc0daf9db60',
      saltNonce: '0x000000000000000000000000000000000000000000000000000000006ae34bc8',
    })).toBe('0xb92E6B43A54E80898F0Dfa05259d940C177dfd55')
  })
})

it('imports nothing from node: (the file above reads none either)', () => {
  expect(readFileSync(new URL('../../lib/create2.mjs', import.meta.url), 'utf8')).not.toMatch(/from 'node:/)
})
