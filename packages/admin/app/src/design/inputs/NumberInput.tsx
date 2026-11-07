import { look, type Common, type Look } from './common.ts'

export function NumberInput({ common, value, onChange, ...shown }: { common: Common; value: unknown; onChange: (v: unknown) => void } & Look) {
  const { attrs, after } = look(common, shown)
  return <><input {...attrs} type="number" value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />{after}</>
}
