/** The signers as dots (§12.4, 03): one 20px moss ring per signer, the first `threshold` filled. Decorative: the
 *  words beside them ("Any 4 of 8") say the same, and the row's name says it for a screen reader. */
export function SignerDots({ threshold, signers }: { threshold: number; signers: number }) {
  return (
    <span className="door-dots" role="img" aria-label={`${threshold} of ${signers} signatures needed`}>
      {Array.from({ length: signers }, (_, i) => <i key={i} className={i < threshold ? 'door-dot is-on' : 'door-dot'} />)}
    </span>
  )
}
