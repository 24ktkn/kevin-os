import { google, sheets_v4 } from 'googleapis';

const SPREADSHEET_ID = '1qk4gIOjv6iIvAJH_VCQWa2npgME9-saesUNVyPbuPmA';

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

let cachedSheetsClient: sheets_v4.Sheets | null = null;
let cachedSheetsEmail = '';

export function getGoogleSheetsClient(): sheets_v4.Sheets {
  const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || '').replace(/^["']|["']$/g, '').trim();
  const privateKey = getPrivateKey();

  if (!clientEmail || !privateKey) {
    throw new Error('Google Service Account credentials missing');
  }

  if (cachedSheetsClient && cachedSheetsEmail === clientEmail) {
    return cachedSheetsClient;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  cachedSheetsEmail = clientEmail;
  cachedSheetsClient = google.sheets({ version: 'v4', auth });
  return cachedSheetsClient;
}

const HABIT_COL_MAP: Record<string, string> = {
  'Wake Up On Time': 'B',
  'Gym Workout': 'C',
  'Journaling': 'D',
  'Anki': 'E',
};

/**
 * Mirrors a single habit's completion state to the Google Sheets `Habits` tab.
 * Safely updates existing row or appends a new row if targetDate is not yet present.
 */
export async function mirrorHabitToSheets(
  targetDate: string,
  habitName: string,
  isCompleted: boolean
): Promise<void> {
  try {
    const colLetter = HABIT_COL_MAP[habitName];
    if (!colLetter) return;

    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Habits!A1:E1005',
    });

    const rows = res.data.values || [];
    const targetRowIdx = rows.findIndex((row) => String(row[0] || '').trim() === targetDate);

    if (targetRowIdx !== -1) {
      const sheetRowNumber = targetRowIdx + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Habits!${colLetter}${sheetRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[isCompleted ? 'TRUE' : 'FALSE']],
        },
      });
    } else {
      const newRow = [
        targetDate,
        habitName === 'Wake Up On Time' && isCompleted ? 'TRUE' : 'FALSE',
        habitName === 'Gym Workout' && isCompleted ? 'TRUE' : 'FALSE',
        habitName === 'Journaling' && isCompleted ? 'TRUE' : 'FALSE',
        habitName === 'Anki' && isCompleted ? 'TRUE' : 'FALSE',
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Habits!A:E',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [newRow],
        },
      });
    }
  } catch (err) {
    console.warn('Google Sheets habit mirror warning:', err);
  }
}

export { SPREADSHEET_ID };
