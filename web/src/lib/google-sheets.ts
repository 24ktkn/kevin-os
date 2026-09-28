import { google } from 'googleapis';

const SPREADSHEET_ID = '1qk4gIOjv6iIvAJH_VCQWa2npgME9-saesUNVyPbuPmA';

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

export function getGoogleSheetsClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (!clientEmail || !privateKey) {
    throw new Error('Google Service Account credentials missing');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

export { SPREADSHEET_ID };
