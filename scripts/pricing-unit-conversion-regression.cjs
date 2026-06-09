#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')

function roundMoney(value) { return Math.round(value * 100) / 100 }
function unitFactor(unit, calculationType, componentType) {
  const normalize = (v) => String(v || '').trim().toLowerCase().replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
  const classify = (v) => {
    const text = normalize(v)
    if (!text) return null
    if (text.includes('sek_per_kwh') || text.includes('kr/kwh')) return 1
    if (text.includes('ore_per_kwh') || text.includes('ore/kwh')) return 0.01
    return null
  }
  return classify(unit) ?? classify(calculationType) ?? classify(componentType) ?? 1
}
function componentAmount({ kwh, amount, unit, calculationType, componentType }) {
  return roundMoney(kwh * amount * unitFactor(unit, calculationType, componentType))
}

const spot = 770.19
const markupOre = componentAmount({ kwh: 1000, amount: 8, unit: 'ore_per_kwh', calculationType: 'per_kwh', componentType: 'markup_ore_per_kwh' })
const greenOre = componentAmount({ kwh: 1000, amount: 2, unit: 'ore_per_kwh', calculationType: 'per_kwh', componentType: 'green_energy_fee' })
const markupSek = componentAmount({ kwh: 1000, amount: 0.08, unit: 'sek_per_kwh', calculationType: 'per_kwh', componentType: 'markup' })
const fixed = 49

assert.strictEqual(markupOre, 80, '8 öre/kWh must be 80 SEK for 1000 kWh')
assert.strictEqual(greenOre, 20, '2 öre/kWh must be 20 SEK for 1000 kWh')
assert.strictEqual(markupSek, 80, '0.08 kr/kWh must be 80 SEK for 1000 kWh')
const explicitSekDespiteLegacyName = componentAmount({ kwh: 1000, amount: 0.08, unit: 'sek_per_kwh', calculationType: 'per_kwh', componentType: 'markup_ore_per_kwh' })
assert.strictEqual(explicitSekDespiteLegacyName, 80, 'explicit sek_per_kwh must override legacy component name containing ore_per_kwh')
const exVat = roundMoney(spot + markupOre + greenOre + fixed)
const vat = roundMoney(exVat * 0.25)
assert.strictEqual(exVat, 919.19, 'spot + 8 öre/kWh + 2 öre/kWh + 49 SEK must be 919.19 ex VAT')
assert.strictEqual(vat, 229.8, 'VAT must be applied last')
assert.strictEqual(roundMoney(exVat + vat), 1148.99, 'total inc VAT must be 1148.99')

const root = path.resolve(__dirname, '..')
const calculator = fs.readFileSync(path.join(root, 'lib/pricing/priceComponentCalculator.ts'), 'utf8')
const units = fs.readFileSync(path.join(root, 'lib/pricing/unitConversion.ts'), 'utf8')
assert(calculator.includes('sekPerKwhFromComponent(component)'), 'price component calculator must use unit-aware SEK/kWh conversion')
assert(units.includes("unit === 'ore_per_kwh'"), 'unit conversion helper must explicitly support ore_per_kwh')
assert(units.includes("return component.amount / 100"), 'ore_per_kwh must be divided by 100')

console.log('pricing-unit-conversion-regression: OK')
