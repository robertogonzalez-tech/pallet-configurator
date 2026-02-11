# Notification Setup Guide

## Required Vercel Environment Variables

Add these to your Vercel project settings:

### Email Notification
```
EMAIL_PASSWORD=<iCloud app-specific password>
```
Get from: https://appleid.apple.com → Security → App-Specific Passwords

### Google Sheets Backup
1. Create a new Google Sheet: https://docs.google.com/spreadsheets/create
2. Rename it to "GCS Pallet Validation Tracking"
3. Add header row in Sheet1:
   ```
   Timestamp | SO Number | Validated By | Predicted Pallets | Actual Pallets | Pallet Variance | Predicted Weight | Actual Weight | Weight Variance | Accurate? | Within 1? | Notes
   ```
4. Rename Sheet1 to "Validations"
5. Share the sheet with: `brooke-sheets@brooke-485505.iam.gserviceaccount.com` (Editor access)
6. Copy the Spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
7. Add to Vercel env vars:
   ```
   VALIDATION_SHEET_ID=<spreadsheet-id>
   GOOGLE_SERVICE_ACCOUNT_KEY=<paste entire JSON from ~/.config/clawdbot/google-sheets-service-account.json>
   ```

## Testing

After deployment, submit a validation via the form. Check:
1. Email received at anisa@groundcontrolsystems.com
2. Row added to Google Sheet
3. No errors in Vercel function logs

## Fallback Behavior

If env vars are missing:
- Email: Logs warning, continues without sending
- Sheets: Logs warning, continues without saving
- Validation still saves to Supabase regardless
