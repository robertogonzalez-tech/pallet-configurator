// Test DD4 packing to find gaps
import { packItems } from './src/binPacking3D.js'

const dd4Items = [
  { sku: 'DD4-Slides', name: 'Slides', qty: 1, dims: { l: 80.4, w: 16.5, h: 6.5 }, weight: 100 },
  { sku: 'DD4-Tracks', name: 'Tracks', qty: 1, dims: { l: 79.3, w: 12.2, h: 6.0 }, weight: 80 },
  { sku: 'DD4-Manifolds', name: 'Manifolds', qty: 1, dims: { l: 29.7, w: 12.3, h: 11.8 }, weight: 50 },
]

console.log('=== DD4 TEST: 86×40 pallet ===')
const result = packItems(dd4Items, {
  palletLength: 86,
  palletWidth: 40,
  allowRotation: true,
})

console.log('\n=== FINAL PLACEMENT ===')
for (const pallet of result) {
  console.log(`Pallet ${pallet.id}:`)
  for (const box of pallet.boxes) {
    console.log(`  ${box.item.sku}: pos(${box.x}, ${box.y}, ${box.z}) size(${box.l}×${box.w}×${box.h})`)
    console.log(`    ends at X=${box.x + box.l}, Z=${box.z + box.w}`)
  }

  // Check for gaps
  console.log('\n  Gap analysis:')
  const boxes = pallet.boxes
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]

      // Check if they should be adjacent in X
      if (Math.abs(a.z - b.z) < 0.1 || (a.z < b.z + b.w && b.z < a.z + a.w)) {
        // They overlap in Z, check X gap
        const xGap = Math.min(
          Math.abs((a.x + a.l) - b.x),
          Math.abs((b.x + b.l) - a.x)
        )
        if (xGap > 0.1 && xGap < 50) {
          console.log(`  X-GAP between ${a.item.sku} and ${b.item.sku}: ${xGap.toFixed(2)}"`)
        }
      }

      // Check if they should be adjacent in Z
      if (Math.abs(a.x - b.x) < 0.1 || (a.x < b.x + b.l && b.x < a.x + a.l)) {
        // They overlap in X, check Z gap
        const zGap = Math.min(
          Math.abs((a.z + a.w) - b.z),
          Math.abs((b.z + b.w) - a.z)
        )
        if (zGap > 0.1 && zGap < 50) {
          console.log(`  Z-GAP between ${a.item.sku} and ${b.item.sku}: ${zGap.toFixed(2)}"`)
        }
      }
    }
  }
}
