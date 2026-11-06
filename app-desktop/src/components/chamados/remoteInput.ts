export function videoPoint(clientX: number, clientY: number,
  rect: { left: number; top: number; width: number; height: number }, width: number, height: number) {
  if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return null
  const scale = Math.min(rect.width / width, rect.height / height)
  const w = width * scale, h = height * scale
  const x = (clientX - rect.left - (rect.width - w) / 2) / w
  const y = (clientY - rect.top - (rect.height - h) / 2) / h
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}
const named = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
  'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift', 'Control',
  'Alt', 'Meta', 'CapsLock', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])
export function remoteKey(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (named.has(key)) return key
  return [...key].length === 1 && key.charCodeAt(0) >= 32 ? key : null
}
