/** The signers as dots (§12.4, 03): one 20px moss ring per signer, the first `threshold` filled. Decorative: the
 *  words beside them ("Any 4 of 8") say the same, and the row's name says it for a screen reader. */
export function SignerDots({ threshold, signers }: { threshold: number; signers: number }) {
  return (
    <span className="portal-dots" role="img" aria-label={`${threshold} of ${signers} signatures needed`}>
      {Array.from({ length: signers }, (_, i) => <i key={i} className={i < threshold ? 'portal-dot is-on' : 'portal-dot'} />)}
    </span>
  )
}
