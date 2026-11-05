import { vi } from 'vitest'

/** What React Flow needs from a browser and jsdom lacks (the stubs from the xyflow testing guide).
 *  The ResizeObserver entry carries a contentRect: @xyflow/system reads its width on every pane
 *  resize, and crashes without one (ruling C2). An element's size is its inline style's, else 1. */
export function flowEnv(): void {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const el = target as HTMLElement
      this.cb([{ target, contentRect: { width: el.offsetWidth, height: el.offsetHeight } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  }
  class Matrix {
    m22: number
    constructor(t?: string) { const s = t?.match(/scale\(([1-9.]+)\)/)?.[1]; this.m22 = s !== undefined ? Number(s) : 1 }
  }
  vi.stubGlobal('ResizeObserver', RO)
  vi.stubGlobal('DOMMatrixReadOnly', Matrix)
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 1 } },
    offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 1 } },
  })
  ;(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
}
