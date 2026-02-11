# Custom Validation Form Specification

## Context
BOL data from AIT is unreliable (wrong pallet counts, missing weights). We're pivoting to manual validation where Chad/Anisa enter actual shipping data directly into the configurator app.

## Requirements

### 1. UI Location
Add a new "Validate Shipment" tab to the existing mode switcher (Sales/Validation/Warehouse).

### 2. Form Fields

**Top section:**
- Sales Order # (4-digit number input, required)
- Validated by (dropdown: Chad, Anisa, Brady, Connor)
- Notes (textarea, optional)

**Pallet Table (dynamic rows):**
Each row has:
- Pallet # (auto-numbered: 1, 2, 3...)
- Weight (lbs) - number input, required
- Length (in) - number input, required
- Width (in) - number input, required  
- Height (in) - number input, required
- Delete button (remove this row)

**Controls:**
- "+ Add Pallet" button (adds a new row to the table)
- Auto-calculated totals at bottom:
  - Total Pallets: [count]
  - Total Weight: [sum] lbs

**Submit button:** "Submit Validation"

### 3. Submit Logic

When user clicks Submit:

1. **Validate inputs**
   - SO# is 4 digits
   - At least 1 pallet row exists
   - All pallet fields filled

2. **Look up SO in NetSuite**
   - Use existing NetSuite integration (see `api/quote.js`)
   - Get sales order items

3. **Run configurator prediction**
   - Use existing pallet optimizer (see `src/palletOptimizer.js`)
   - Get predicted pallets, weight, breakdown

4. **Compare predicted vs actual**
   - Calculate variance (pallets, weight)
   - Flag accuracy metrics

5. **Save to Supabase**
   - Table: `validations`
   - Fields: see `docs/database-schema.sql`
   - Include:
     - `pick_ticket_id`: SO# (e.g., "SO7706")
     - `sales_order_id`: same as pick_ticket_id
     - `predicted_pallets`, `predicted_weight`, `predicted_breakdown`
     - `actual_pallets`: count of pallet rows
     - `actual_weight`: sum of pallet weights
     - `actual_dimensions`: JSON array of pallet dims
     - `actual_notes`: user notes
     - `validated_by`: selected user
     - `validated_at`: current timestamp
     - `status`: "validated"

6. **Email Anisa**
   - Use Brooke email script: `~/clawd/bin/brooke-email`
   - Subject: "Validation: SO[####] - [X] pallets"
   - Body: HTML table with:
     - SO#, validated by, timestamp
     - Predicted: pallets, weight
     - Actual: pallets, weight
     - Variance: pallets, weight
     - Pallet breakdown table
   - To: anisa@groundcontrolsystems.com (confirm with Berto first)

7. **Save to Google Sheet**
   - Sheet name: "Pallet Validations"
   - Append row with: timestamp, SO#, validated_by, predicted_pallets, actual_pallets, predicted_weight, actual_weight, variance_pallets, variance_weight, notes
   - Use existing Google Sheets integration (service account credentials)

8. **Show success message**
   - Display: "✅ Validation saved for SO[####]"
   - Show variance summary
   - Clear form for next entry

### 4. Mobile-Friendly
- Chad will use this on his phone while shipping
- Large touch targets (buttons, inputs)
- Readable font sizes
- Simple, clean layout

### 5. Files to Create/Modify

**New files:**
- `src/components/ValidationForm.jsx` - Main form component
- `src/components/PalletTable.jsx` - Dynamic pallet rows
- `api/validate-shipment.js` - Backend submit handler

**Modify:**
- `src/App.jsx` - Add ValidationForm to mode switcher
- `src/components/ModeSwitcher.jsx` - Add "Validate" tab
- `docs/database-schema.sql` - Add `actual_dimensions` column if needed

### 6. Existing Code to Reuse

- NetSuite lookup: `api/quote.js` (getSalesOrderItems function)
- Pallet optimizer: `src/palletOptimizer.js` (optimizeOrder function)
- Supabase client: `src/lib/supabase.js`
- Email script: `~/clawd/bin/brooke-email`
- Google Sheets: Service account at `~/.config/clawdbot/google-sheets-service-account.json`

### 7. Data Schema

**Pallet row object:**
```json
{
  "palletNum": 1,
  "weight": 1104,
  "length": 48,
  "width": 40,
  "height": 48
}
```

**Validation save payload:**
```json
{
  "pick_ticket_id": "SO7706",
  "sales_order_id": "SO7706",
  "predicted_pallets": 1,
  "predicted_weight": 1100,
  "predicted_breakdown": [...],
  "actual_pallets": 1,
  "actual_weight": 1104,
  "actual_dimensions": [
    {"palletNum": 1, "weight": 1104, "length": 48, "width": 40, "height": 48}
  ],
  "actual_notes": "Optional notes",
  "validated_by": "Chad",
  "validated_at": "2026-02-11T13:55:00.000Z",
  "status": "validated"
}
```

## Success Criteria

- Chad can open the form on his phone
- Enter SO# and see it auto-populate items from NetSuite
- Add multiple pallet rows with dims/weights
- Submit and see prediction vs actual comparison
- Data saves to Supabase, Anisa gets email, backup to Google Sheets
- Form clears and is ready for next entry

## Questions for Berto

1. Anisa's email: anisa@groundcontrolsystems.com? (confirm)
2. Google Sheet: new sheet or existing? (provide sheet ID if existing)
3. Auto-populate items preview: show NetSuite items before submit, or just validate SO# exists?
4. Pallet dimensions: all required or optional?

Start with the core form and Supabase save first, then add email/sheets integration.
