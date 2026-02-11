const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// Email notification to Anisa
async function sendValidationEmail(validationData) {
  if (!process.env.EMAIL_PASSWORD) {
    console.warn('⚠️  EMAIL_PASSWORD not set - skipping email notification');
    return;
  }

  const transporter = nodemailer.createTransporter({
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    auth: {
      user: 'brookeellis12493@icloud.com',
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const { soNumber, predicted, actual, variance, validatedBy, notes } = validationData;
  
  const subject = `Pallet Validation: ${soNumber} (${variance.palletAccurate ? '✅ Exact' : variance.withinOnePallet ? '⚠️ ±1' : '❌ Off'})`;
  
  const html = `
    <h2>New Pallet Validation Submitted</h2>
    <p><strong>Sales Order:</strong> ${soNumber}</p>
    <p><strong>Validated By:</strong> ${validatedBy}</p>
    
    <h3>Results:</h3>
    <table border="1" cellpadding="8" cellspacing="0">
      <tr>
        <th></th>
        <th>Predicted</th>
        <th>Actual</th>
        <th>Variance</th>
      </tr>
      <tr>
        <td>Pallets</td>
        <td>${predicted.pallets}</td>
        <td>${actual.pallets}</td>
        <td style="color: ${variance.palletAccurate ? 'green' : variance.withinOnePallet ? 'orange' : 'red'}">
          ${variance.pallets > 0 ? '+' : ''}${variance.pallets}
        </td>
      </tr>
      <tr>
        <td>Weight</td>
        <td>${predicted.weight} lbs</td>
        <td>${actual.weight} lbs</td>
        <td>${variance.weight > 0 ? '+' : ''}${variance.weight} lbs</td>
      </tr>
    </table>
    
    <p><strong>Accuracy:</strong> ${variance.palletAccurate ? '✅ Exact match' : variance.withinOnePallet ? '⚠️  Within 1 pallet' : '❌ More than 1 pallet off'}</p>
    
    ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
    
    <p style="color: #666; font-size: 12px;">View full validation data in Supabase or Google Sheets backup.</p>
  `;

  await transporter.sendMail({
    from: 'Brooke <brookeellis12493@icloud.com>',
    to: 'anisa@groundcontrolsystems.com',
    subject,
    html
  });
  
  console.log('✅ Email sent to Anisa');
}

// Google Sheets backup
async function saveToGoogleSheets(validationData) {
  if (!process.env.VALIDATION_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.warn('⚠️  Google Sheets not configured - skipping backup');
    return;
  }

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const { soNumber, predicted, actual, variance, validatedBy, notes } = validationData;

  const row = [
    new Date().toISOString(),
    soNumber,
    validatedBy,
    predicted.pallets,
    actual.pallets,
    variance.pallets,
    predicted.weight,
    actual.weight,
    variance.weight,
    variance.palletAccurate ? 'YES' : 'NO',
    variance.withinOnePallet ? 'YES' : 'NO',
    notes || ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.VALIDATION_SHEET_ID,
    range: 'Validations!A:L',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row]
    }
  });
  
  console.log('✅ Saved to Google Sheets');
}

module.exports = { sendValidationEmail, saveToGoogleSheets };
